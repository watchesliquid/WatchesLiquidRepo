# Contributing

This repository is published so the system can be audited. Issues and pull requests are welcome,
and so is a report that simply says "this is wrong and here is why".

**Anything that could move funds goes to [SECURITY.md](SECURITY.md) first, privately.** Not a
public issue.

## Before you open a PR

```bash
npm install
npm run lint    # typecheck every workspace
npm test        # the tests/ suites — no server, no chain, no database needed
npm run build
```

CI runs the same three on every push and pull request. All three pass on `main`; if one fails on
your branch it is your branch.

## The rules that are not style

These exist because breaking them cost real money or nearly did. Each is enforced by a test in
`tests/`, and the test comment explains the failure it prevents.

**Nothing may `await` between reading `balance_usd` and writing it.** Node is single-threaded, so
a synchronous check-and-deduct is atomic; an `await` in the middle is not. `/positions/open` is
synchronous and will run to completion inside any such window. This was a live double-spend
between withdraw and position-open.

**Use `flushDb()`, not `saveDb()`, before anything irreversible leaves the process.** `saveDb`
debounces 200ms. A withdrawal recorded as `pending` under the debounce could still be in memory
when the transfer went out — and the chain does not un-send.

**No admin route may move funds or write a balance.** `tests/admin-surface.test.ts` walks the
router and fails the build if one appears. Support may *resolve* a deposit or withdrawal; it may
not *decide* one. If you are adding a route and wondering which side of that line it falls on,
the question is whether it can increase what a user is owed beyond what the chain already shows.

**Deposit dedupe keys on `txHash:logIndex`, never `txHash` alone.** Measured on live traffic: one
transaction routinely carries nine transfers to the same address. Keying on the hash credited 3
of 27 real deposits.

**A reverted transaction does not throw.** viem's `waitForTransactionReceipt` resolves normally
with `status: "reverted"`. Check the status; do not assume try/catch caught it.

**The keeper runs as one process.** The nonce queue, the rate limiter and the auth replay store
are all in-process. If you need to scale out, those move to shared storage first — do not just
raise the instance count.

## Adding a test

`tests/` is for suites that run anywhere: no server, no chain, no database file. `scripts/` is
for the ones that need a live keeper. Keeping that line clean is what makes `npm test` runnable
in CI and by anyone reading the repo.

Several suites assert against source text rather than behaviour — that a route is absent, that no
client file touches `localStorage`. That is deliberate where the property cannot be observed from
Node, and the comment above each says so.

## Style

TypeScript strict everywhere. Named exports only. REST routes with standard status codes and
`{ error: string }` bodies. Prices in USD throughout.

Comments should explain **why**, especially when the code looks wrong and is not. Most of the
non-obvious code here is non-obvious because a simpler version was broken; say which.
