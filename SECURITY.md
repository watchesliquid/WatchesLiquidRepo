# Security Policy

## Reporting a vulnerability

Please report privately first. Do not open a public issue for anything that could
be used to move funds.

- **GitHub:** open a [private security advisory](https://github.com/watchesliquid/Watches-Liquid/security/advisories/new)
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

**Administrators can move funds.** Addresses listed in `ADMIN_ADDRESSES` can
send from the hot wallet and set user balances. This is intentional — it is how
support and recovery are handled. It is bounded, not prevented:

- The allowlist lives in an environment file, not the database, so no route,
  injection, or bad write can grant admin. Promotion requires filesystem access
  to the server.
- An empty allowlist denies everyone, including would-be admins.
- Money-moving actions are capped per action, rate-limited, require a typed
  confirmation phrase and a written reason, and are recorded to an audit log
  *before* the transaction is broadcast, so a crash mid-send still leaves a trail.

Anyone holding a valid admin session can still move funds. The caps limit
blast radius; they are not a security boundary.

**Prices are simulated.** There is no live watch price feed. Prices come from an
internal simulator running on a compressed clock. See the README — this is
stated on the live site's docs page as well.

**Funding is not zero-sum.** Payments scale with each position's notional, and
open interest is not balanced between longs and shorts, so the house absorbs the
difference. There is no LP pool accounting for it yet.

**The database is a JSON file** held in memory and written on a debounce. A hard
crash can lose the most recent moments of state.

**The API must run as a single process.** Withdrawal nonces are serialised
in-process. Running more than one instance would let two workers claim the same
nonce, and one transfer would silently replace the other.

## Out of scope

- Findings that require an already-compromised server or admin session
- Denial of service through ordinary traffic volume
- Automated scanner output without a demonstrated exploit path
- The simulated price model itself (see above)
