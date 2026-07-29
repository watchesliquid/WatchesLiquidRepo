# Security Policy

## Reporting a vulnerability

Please report privately first. Do not open a public issue for anything that could
be used to move funds.

- **GitHub:** open a [private security advisory](https://github.com/watchesliquid/WatchesLiquidRepo/security/advisories/new)
- **X/Twitter DM:** [@WatchesLiquid](https://x.com/WatchesLiquid)

We aim to acknowledge within 72 hours. Please give us a reasonable window to
ship a fix before publishing.

## What we consider in scope

Anything that lets someone move funds they do not own, read another user's
data, forge authentication, or halt the exchange:

- Authentication bypass or signature forgery
- Withdrawal logic — double-spend, race conditions, limit bypass
- Deposit crediting — double-credit, attribution to the wrong account
- Admin authorisation bypass
- Margin, liquidation, or PnL math that can be driven to an incorrect result

## Known and accepted design limitations

These are not vulnerabilities. They are deliberate trade-offs, documented so
you do not spend time reporting them — and so users can judge them for
themselves.

**The platform is custodial.** One hot wallet holds all user funds. Balances are
rows in the platform's database, not on-chain positions. Trades never touch the
chain; only deposits and withdrawals do. If the platform's server is
compromised, user funds are at risk. This is the single largest risk in the
system.

**No API route can move funds or create a balance.** This is worth stating
precisely, because the precise version is narrower than it first sounds.

There used to be two admin routes that could: `POST /admin/send`, which
transferred from the hot wallet to any address, and `POST /admin/users/:id/balance`,
which set a balance outright. Together they were a complete value-creation path —
a balance written by the second leaves as real USDG through the ordinary
withdrawal route — so any stolen admin session was a mint. Both are gone. They
were capped, rate-limited, confirmation-gated and audited, and none of that was
a security boundary, because the same session could simply repeat the request.

What an admin session can still do is support work, and only support work: read
every statistic, pause withdrawals, pause a market, and two bounded actions for
resolving a stuck deposit or withdrawal.

*Crediting an unattributed deposit* — a transfer that already arrived on-chain,
whose amount is read from the stored log and never from the request body. It
cannot credit value nobody deposited. It exists because a deposit sent from an
exchange arrives with a sender matching no account, and without it that user's
real money would be unreachable forever.

*Re-checking a pending withdrawal* — re-runs the automatic reconciler against one
row. The caller chooses which withdrawal; the chain decides the outcome. There is
no parameter for the result, the amount or the destination, and it calls the same
function the background sweep calls every two minutes, so it cannot reach an
outcome that sweep would not have reached on its own. It saves a user waiting on
a ticket; it does not give anyone discretion over a balance.

Neither action can increase what a user is owed beyond what the chain already
shows. That is the line: support can *resolve* deposits and withdrawals, and
cannot *decide* them.

`tests/admin-surface.test.ts` asserts this: it walks the router and fails the
build if either removed route returns, if `admin.ts` so much as imports the
transfer primitive, or if any new mutating route appears that has not been
consciously allowlisted.

**This does not mean funds are unmovable.** The withdrawal path needs the hot
wallet key, so `PLATFORM_WALLET_KEY` is loaded from the server environment.
Anyone with filesystem access to that machine can move everything, and no
application-level change alters that. What changed is that a remote attacker now
needs the server rather than a session — a lifted JWT, a phished admin
signature, or an XSS in the panel no longer reaches user funds.

The custodial risk in the section above is therefore unchanged and remains the
largest risk in the system.

Admin actions are published, after redaction, at
`GET /api/transparency/audit-log` — amounts and destinations unredacted. Solvency
is independently checkable at `GET /api/transparency/reserves`, which publishes
the custody wallet address so you can read its balance on the explorer yourself
rather than trusting the ratio we print.

Both endpoints read the same database an attacker with server access would
control. Treat them as evidence for ordinary operation, not as a guarantee
against a compromised host.

**Prices are simulated.** There is no live watch price feed. Prices come from an
internal simulator running on a compressed clock. Every API response carrying a
price also carries `pricesSimulated`, and `GET /api/transparency/oracle`
describes the active source. See the README — this is stated on the live site's
docs page as well.

**Funding is not zero-sum.** Payments scale with each position's notional, and
open interest is not balanced between longs and shorts, so the house absorbs the
difference. There is no LP pool accounting for it yet.

**The database is a JSON file** held in memory and written on a debounce. A hard
crash can lose the most recent moments of state.

**Sessions are httpOnly cookies, not localStorage.** The token used to be kept in
localStorage, where any script on the page can read it — one XSS, in our code or
in a dependency, was a stolen 7-day session. The cookie is `HttpOnly`,
`SameSite=Strict`, and `Secure` outside development.

An XSS can still act as the user while the page is open. What it can no longer do
is take the credential away with it.

`SameSite=Strict` is free here because the app and the API share an origin —
nginx proxies `/api/` in production, the Next config rewrites it in development —
so no cross-site request ever carries the cookie, and there is no CSRF token to
add. The `Authorization: Bearer` path is still accepted, for the CLI scripts,
which have no cookie jar.

**The API must run as a single process.** Three things keep state in-process and
assume one instance:

- Withdrawal nonces are serialised through one queue. Two workers would claim the
  same nonce, and one transfer would silently replace the other.
- The rate limiter's counters. A second instance allows twice the configured rate.
- The auth replay store, which makes each signed login message single-use. A
  second instance would let a captured message be spent once per instance.

The replay store is also cleared by a restart, which reopens a replay window of at
most the 5-minute message lifetime. Persisting it would mean writing to the same
JSON file that holds user balances on every login; that trade was made
deliberately and is worth challenging if you disagree.

## Out of scope

- Findings that require an already-compromised server or admin session
- Denial of service through ordinary traffic volume
- Automated scanner output without a demonstrated exploit path
- The simulated price model itself (see above)
