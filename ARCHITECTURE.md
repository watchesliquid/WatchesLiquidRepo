# Architecture

How the system is put together, and which parts are load-bearing. Written for someone
auditing it rather than someone extending it.

## Shape

```
frontend/   Next.js 15 App Router, React 19          :3000
keeper/     Express + TypeScript — the whole backend  :3001
shared/     types, constants, market catalog, margin math
tests/      pure suites: no server, no chain, no database
scripts/    suites that need a live keeper
```

One origin in front of both. nginx serves the app at `/` and proxies `/api/` to the keeper in
production; `next.config.mjs` rewrites `/api` to `:3001` in development. Everything downstream —
`SameSite=Strict` session cookies, no CSRF tokens — follows from that.

## Request path

```
client
  └─ /api/*
       ├─ cors(allowlist)              CORS_ORIGINS, explicit list, no wildcard
       ├─ express.json({ limit: 32kb })
       ├─ security headers             nosniff, DENY, referrer, permissions
       ├─ rate limits                  see below
       └─ router
            ├─ /auth           wallet signature -> httpOnly session cookie
            ├─ /markets        public
            ├─ /positions      authMiddleware
            ├─ /account        authMiddleware   deposits, withdrawals
            ├─ /transparency   PUBLIC, unauthenticated, by design
            └─ /admin          authMiddleware + requireAdmin
```

### Rate limiting

Applied with `app.use` in `keeper/src/index.ts`, so it covers every route on a prefix rather
than being opted into per handler. Tightest where money or accounts are created:

| Prefix | Window | Max |
|---|---|---|
| `/api/auth` | 60s | 20 |
| `/api/account/withdraw` | 1h | 10 |
| `/api/account/deposit/check` | 60s | 10 |
| `/api/positions` | 60s | 120 |
| `/api/transparency` | 60s | 60 |
| `/api` (catch-all) | 60s | 600 |

In-process counters. Correct only at one instance — see "Single process" below.

## Persistence

**It is a JSON file, and that is a real limitation.** `keeper/src/db/memory.ts` holds an
in-memory object and writes it to `keeper/data/watchperps.json`. It is not a database, has no
schema, no transactions, and no concurrent access story. Moving to SQLite or Postgres is the
most substantial open item on this codebase.

What it does guarantee:

- **Writes are atomic.** Serialise to `.tmp`, then `rename` over the target. A partial file can
  never replace a good one — a crash mid-write leaves the previous state intact, not a corrupt
  one.
- **The whole store is one blob.** Balances, dedupe keys, the deposit cursor and withdrawal rows
  land together or not at all. Several ordering guarantees in the code actually rest on this
  rather than on the sequence of save calls.
- **State survives restarts.** `loadDb()` restores on boot, and only keys present in the `memDb`
  literal — a collection not listed there is silently dropped, which is a real footgun when
  adding one.

There are two write paths and the difference matters:

`saveDb()` debounces 200ms, plus a 10s autosave. Correct for anything replayable. The deposit
scanner uses it: a lost write means the chunk is rescanned and re-credited, because the dedupe
keys were not persisted either. The worst case is repeated work.

`flushDb()` writes synchronously and cancels the pending debounce. Used where the next action is
irreversible and off-box. The withdrawal route records a withdrawal as `pending` **before**
broadcasting, so a crash mid-send leaves a row the reconciler can resolve — and under the
debounce that record could still be in memory when the transfer went out. The chain does not
un-send. `flushDb` throws rather than logging, so a caller about to move money can abort if the
record of it cannot be written.

## Withdrawal lifecycle

The most safety-critical path in the system.

```
check balance ─┐
deduct         │ synchronous: no await between reading balance_usd and writing it
push pending  ─┘
flushDb()                      durable BEFORE anything leaves
  ↓
gas pre-flight                 refuse early; release the reservation on this path
  ↓
sendUsdg(..., onBroadcast)     onBroadcast fires between "on the wire" and "awaiting receipt"
  └─ record txHash, flushDb()  so a crash during the wait is not read as "never broadcast"
  ↓
receipt: success | reverted    viem does NOT throw on revert — callers must check status
```

Anything still `pending` is resolved by `reconcilePendingWithdrawals`, on boot and every
`WITHDRAW_RECONCILE_MS` (default 120s). It acts on exactly three outcomes:

| Observed | Action |
|---|---|
| no txHash | never broadcast — restore the balance |
| receipt `success` | confirmed — balance stays debited |
| receipt `reverted` | nothing moved — restore the balance |

A txHash with no receipt yet is **left pending**. Guessing there is the double-spend the
function exists to prevent.

Known gap: a transaction dropped from the mempool never gets a receipt, so it stays pending
indefinitely and the balance stays debited. Resolving it correctly needs the account nonce
compared against the transaction's, which is not recorded today.

## Deposits

One `eth_getLogs` per tick covers every user — the recipient is an indexed topic on the ERC20
`Transfer` event, so the node filters server-side. 2000-block chunks, ≤50 chunks per tick, cursor
in `memDb.chainState` keyed by **chain id** so switching chains is a cold start rather than a
cursor carried to a chain where the height means nothing.

Dedupe keys on `txHash:logIndex`, never `txHash` alone — one transaction routinely carries
several transfers to the same address. Keys live in `keeper/src/db/credited-txs.ts` with a
bounded retained history; pruning switches off when `EVM_START_BLOCK` is set, since that is the
one setting that legitimately rewinds the cursor over already-credited blocks.

Deposits from an exchange or contract wallet have a sender matching no account. They are stored
as unattributed rather than lost, and can be credited by an admin from the stored log.

## Trust boundaries

**Custodial.** One hot wallet holds every user's USDG; balances are database rows. Trades never
touch the chain — only deposits and withdrawals do.

**No API route can move funds or write a balance.** The two that could were removed; a test walks
the router and fails the build if either returns or if a new mutating route appears
un-allowlisted. This is not the same as funds being immovable: the withdrawal path needs the hot
wallet key, so it is on the server, and filesystem access to that machine still moves everything.
What is closed is the remote path.

**Admin is env-gated.** `ADMIN_ADDRESSES` lives in the environment file, not the database, so no
route, injection or bad write can grant it. Empty denies everyone.

**Sessions are httpOnly cookies.** `SameSite=Strict`, `Secure` outside development. Not reachable
from JavaScript, so an XSS can act as the user while the page is open but cannot take the
credential away.

## Single process

Three things keep state in-process and assume exactly one instance:

- the withdrawal nonce queue in `evm.ts` — two workers would claim the same nonce and one
  transfer would silently replace the other
- the rate limiter's counters
- the auth replay store, which makes each signed login single-use

## Prices

Simulated. An Ornstein-Uhlenbeck walk in log-price, mean-reverting to a per-watch anchor, on a
compressed clock where one 30-second tick is one simulated day. `resolvePriceSource()` picks the
first available source, so setting `WATCHCHARTS_API_KEY` switches to a real feed with no code
change — the adapter is a stub because a real feed needs a licensed data source.

Every API response carrying a price also carries `pricesSimulated`, so the disclosure travels
with the number rather than living only in a README.

## Verification surface

Three public, unauthenticated endpoints, so the claims above can be checked instead of believed:
`/api/transparency/reserves`, `/api/transparency/audit-log`, `/api/transparency/oracle`. See
[README](README.md#verify-it-yourself). Both read the same database an attacker with server
access would control — evidence for ordinary operation, not a guarantee against a compromised
host.
