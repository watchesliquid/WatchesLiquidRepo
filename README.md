# Watches Liquid

[![CI](https://github.com/watchesliquid/WatchesLiquidRepo/actions/workflows/ci.yml/badge.svg)](https://github.com/watchesliquid/WatchesLiquidRepo/actions/workflows/ci.yml)

Perpetual futures on luxury watch prices. Long or short a Daytona or a Nautilus
with leverage, settle in USDG, never take delivery of a watch.

This repository is published so the system can be audited. If you find
something that can move funds, please read [SECURITY.md](SECURITY.md) first.

[Architecture](ARCHITECTURE.md) · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

---

## Read this before you deposit

Three things about how this works. All three are stated on the live site too.

**1. Prices are simulated.** There is no live watch price feed. Prices come from
an internal simulator — an Ornstein-Uhlenbeck walk in log-price, mean-reverting
to a per-watch anchor, running on a compressed clock where one 30-second tick
represents one simulated day. Every API response containing a price also carries
`pricesSimulated`, and `GET /api/transparency/oracle` describes the active
source in full. `keeper/src/services/price/watchcharts.ts` is a stub for a real
feed that is not yet enabled — a real one needs a licensed data source, since
WatchCharts blocks automated access.

**2. It is custodial.** One hot wallet holds all user funds. Your balance is a
row in a database, not an on-chain position. Trades never touch the chain — only
deposits and withdrawals do. If our server is compromised, user funds are at
risk. This is the largest single risk in the system.

**3. No API route can move your funds or edit your balance.** The two admin
routes that could — send-from-wallet and set-balance — have been removed, and a
test fails the build if either returns. What is left is support, not control:
stats, pause switches, crediting a deposit that already arrived on-chain, and
re-checking a stuck withdrawal against the chain. Neither of those last two can
increase what you are owed beyond what the chain already shows — support can
resolve a deposit or withdrawal, but cannot decide it.

That is not the same as "your funds are safe". The withdrawal path needs the hot
wallet key, so it lives on the server, and anyone with access to that machine can
still move everything. What it rules out is a *remote* path: a stolen admin
session no longer reaches user funds. See [SECURITY.md](SECURITY.md) for exactly
where the line falls.

Not affiliated with or endorsed by any watch manufacturer. Markets are
identified by reference number; no brand logos or press images are used.

---

## Verify it yourself

Three public endpoints, no authentication and no account required. They exist so
the claims above can be checked rather than believed.

| Endpoint | What it answers |
|---|---|
| `GET /api/transparency/reserves` | Does the custody wallet actually hold what users are owed? |
| `GET /api/transparency/audit-log` | What have administrators done, and where did funds go? |
| `GET /api/transparency/oracle` | Are prices real or simulated, right now? |

`reserves` publishes the custody wallet address and compares its on-chain USDG
balance against total user claims — wallet balances, plus collateral locked in
open positions, plus unrealised profit at the current mark. **Do not trust the
ratio it prints.** It gives you the address; read the balance yourself on the
explorer and redo the division.

The liability side is deliberately overstated: unrealised profit counts as owed,
and the close fee every exit would really pay is not deducted. The coverage
figure is therefore a floor, not a best case. It can print below 1 — funding is
not zero-sum on a skewed book, so the house can run a deficit — and it will show
that rather than hide it.

`audit-log` is the same log administrators see, with request IPs stripped and
user identifiers truncated. Amounts and withdrawal destinations are **not**
redacted, because where money went is the entire point of publishing it. Note
what this is not: the log lives in the same database it describes, so it is
evidence for users, not a tamper-proof ledger. An attacker holding the server
holds both.

---

## Architecture

| | |
|---|---|
| **Frontend** | Next.js 15 App Router, React 19, port 3000 |
| **Backend** ("keeper") | Express + TypeScript, port 3001 |
| **Database** | In-memory object persisted to a JSON file |
| **Price feed** | Simulated OU walk → adaptive EWMA |
| **Chain** | Robinhood Chain (Arbitrum Orbit L2), USDG collateral, viem |

The engine is domain-neutral: `Position`, `Trade`, and `Candle` carry no
watch-specific fields. The watch domain lives entirely in
`shared/src/markets.ts`.

### Chain

Robinhood Chain is EVM-equivalent with ~100ms blocks. **Gas is ETH, not USDG** —
an unfunded hot wallet fails every withdrawal, so `/withdraw` pre-flights the gas
balance and refuses *before* deducting the user.

| | mainnet | testnet |
|---|---|---|
| chain ID | 4663 | 46630 |
| USDG | `0x5fc5…d168` | `0x915e…03ec` — a different address |

Both are 6 decimals, but `decimals()` is read on-chain at runtime and **fails
closed** rather than defaulting. An 18-vs-6 mistake is a 10¹² error.

### Deposits

One `eth_getLogs` per tick covers every user, because the recipient is an indexed
topic on the ERC20 `Transfer` event. The block cursor is keyed by chain ID and
persisted, so a restart resumes instead of skipping, and switching chains is a
cold start rather than a cursor carried to a chain where it means nothing.

Dedupe keys on `txHash:logIndex`, never `txHash` alone — a single transaction
routinely carries multiple USDG transfers to the same address, and keying on the
hash alone silently drops all but the first. The keys live in
`keeper/src/db/credited-txs.ts`, which keeps a bounded recent history rather than
every key ever seen; pruning is disabled when `EVM_START_BLOCK` is set, since that
is the one setting that legitimately rewinds the cursor over already-credited
blocks.

Deposits sent from an exchange or contract wallet cannot be attributed to a user
(the sender is not their address). Those are recorded as unattributed rather than
lost, and can be credited manually.

Set `EVM_RPC_FALLBACKS` to a comma-separated list of failover endpoints. With a
single RPC, an outage stops deposit scanning and withdrawal reconciliation at
once — and stops them *quietly*, because a failed scan is safe by design, so the
keeper stays healthy and simply stops seeing deposits. Every configured endpoint
is checked against `EVM_CHAIN_ID` at boot and the process refuses to start on a
mismatch: failing over onto the wrong chain would scan foreign blocks and credit
nobody.

### Margin

All margin math is in `shared/src/margin.ts`. One rule:

> Liquidate when equity ≤ `MAINTENANCE_MARGIN_RATIO` × **collateral** —
> equivalently when the mark crosses `entry × (1 ∓ 0.95/leverage)`.

`MAINTENANCE_MARGIN_RATIO = 0.05` is 5% **of collateral, not of notional**. Under
a notional rule the ratio at entry is exactly `1/leverage`, so every position
above 20x would liquidate the instant it opened.

`computeMarginRatio` returns equity/notional, which is a **display** value and
not the liquidation trigger. Use `shouldLiquidate`.

### Trading parameters

Max leverage 50x (banded per market), open/close fee 0.1% of notional,
maintenance margin 5%, funding every 8h, max 5 positions per user, profit cap
300% ROE, liquidation fee 1.25% of notional.

Fees are charged on notional, so PnL and fees both scale with leverage and
cancel: **break-even is always `2 × feeRate`** regardless of leverage. At the
older 2% rate, round-trip fees cost 100% of collateral at 25x, and
`requiredMargin = size + fee` made anything above ~49x impossible to open.

---

## Running it

```bash
npm install
cp keeper/.env.example keeper/.env    # then fill it in
npm run dev                            # keeper :3001 + frontend :3000
```

`keeper/.env` needs at minimum:

```bash
JWT_SECRET=            # openssl rand -hex 32 — required, refuses to start without it
EVM_CHAIN_ID=46630     # testnet
PLATFORM_WALLET_KEY=   # hot wallet; must hold ETH for gas
ADMIN_ADDRESSES=       # comma-separated; empty denies everyone
```

Production build:

```bash
npm run build          # frontend + keeper bundle
npm start
```

`NEXT_PUBLIC_EVM_CHAIN_ID` is inlined at **build** time. It must match the
keeper's `EVM_CHAIN_ID`, or the backend watches one chain while users' wallets
are switched to another and deposits land where nothing is scanning.

**The API must run as a single process** — withdrawal nonces are serialised
in-process, and a second instance would let two workers claim the same nonce.

### Tests

```bash
npm run lint         # typecheck every workspace
npm run test         # the tests/ suites — pure, no server or chain needed
npm run test:admin   # admin authorisation boundary, against a local keeper
npm run test:smoke   # deposit/withdraw guards, moves no funds
```

`tests/` holds everything that runs anywhere; `scripts/` holds the ones that need a live keeper.

`test` is pure — no server, no chain, no database file — so it runs anywhere,
and it runs on every push and pull request via the CI badge at the top. Each of
its five suites pins one rule that was previously wrong, or one that must not
break:

- trigger levels must sit on the correct side of the mark
- a deposit may be credited exactly once, however often it is rescanned
- every block in the scan range is visited exactly once
- a signed auth message is redeemable exactly once
- the public audit log never emits a request IP, a full user id or a user wallet
  address — including for admin actions added after the test was written
- no admin route can move funds or create a balance, and none may be added
  without being explicitly allowlisted in the test

`test:smoke` targets `http://localhost:3001/api` by default. Set `SMOKE_API` to
point it at a running deployment.

`test:admin` expects the keeper started with
`ADMIN_ADDRESSES=0x70997970c51812dc3a010c7d01b50e0d17dc79c8` (a standard Anvil
test address).

---

## Layout

```
shared/     types, constants, market catalog, margin math, chain config
keeper/     Express API, price simulator, deposit scanner, risk engine
frontend/   Next.js app
scripts/    test suites
```

| File | Why it matters |
|---|---|
| `shared/src/margin.ts` | All margin math — one liquidation rule, shared by routes and risk engine so they cannot drift |
| `shared/src/chain.ts` | Chain config, address normalisation, auth message format, ERC20 ABI |
| `keeper/src/services/evm.ts` | Clients, signature verification, `sendUsdg` with nonce queue and receipt check |
| `keeper/src/services/deposits.ts` | Transfer log scanner and block cursor |
| `keeper/src/middleware/require-admin.ts` | Admin allowlist — fails closed |
| `keeper/src/db/memory.ts` | The database. `loadDb` only restores keys present in the `memDb` literal |
| `keeper/src/db/credited-txs.ts` | Deposit dedupe keys — membership and retention |
| `keeper/src/services/auth-replay.ts` | Makes each signed auth message single-use |
| `keeper/src/routes/transparency.ts` | Public proof of reserves, redacted audit log, oracle status |

### Things that bite on EVM

- **Reverts don't throw.** viem's `waitForTransactionReceipt` resolves normally
  with `status: "reverted"`. Treating "throw ⇒ failed" would report a reverted
  transfer as a successful withdrawal.
- **Address case.** EIP-55 checksummed and lowercase are the same address and
  different strings. Normalise at every boundary; store lowercase; checksum only
  for display. A slip in auth silently creates a second account.
- **Wrong network.** A user can be connected but on another chain, where
  deposits are unrecoverable by the scanner. The UI surfaces this.

## License

[MIT](LICENSE)
