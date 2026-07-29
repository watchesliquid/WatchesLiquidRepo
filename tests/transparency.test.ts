/**
 * Regression test for the public transparency surface.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/transparency.test.ts
 *
 * Two properties, and the first is the one that must never regress: /api/transparency/audit-log
 * is public and unauthenticated, so anything publicAuditEntry emits is world-readable forever.
 * Request IPs, full user ids and user wallet addresses must never appear in it, including for
 * admin actions that did not exist when this test was written.
 *
 * The second is that proof of reserves states a liability at least as large as what users could
 * actually claim. A coverage ratio is only meaningful if its denominator cannot be flattered.
 */
import { memDb } from "../keeper/src/db/memory";
import { publicAuditEntry, totalUserClaims } from "../keeper/src/routes/transparency";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(54)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const SECRET_IP = "203.0.113.77";
const USER_ID = "3f8a1c22-9d4e-4b1a-9c77-0e5b2a6d1f90";
const USER_WALLET = "0x1111111111111111111111111111111111111111";
const ADMIN = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

// Every audited action, with the sensitive fields the real call sites pass.
const ROWS = [
  { time: "t", action: "wallet.send", admin: ADMIN, target: "0x2222222222222222222222222222222222222222",
    detail: { amount: 250, reason: "support refund", status: "attempting" }, ip: SECRET_IP },
  { time: "t", action: "wallet.send.failed", admin: ADMIN, detail: { error: "insufficient gas" }, ip: SECRET_IP },
  { time: "t", action: "user.balance.set", admin: ADMIN, target: USER_ID, before: 10, after: 60,
    detail: { reason: "goodwill", delta: 50, address: USER_WALLET }, ip: SECRET_IP },
  { time: "t", action: "deposit.claim", admin: ADMIN, target: USER_ID,
    detail: { key: "0xabc:3", amount: 500, from: USER_WALLET }, ip: SECRET_IP },
  { time: "t", action: "withdrawals.pause", admin: ADMIN, before: false, after: true, ip: SECRET_IP },
  { time: "t", action: "market.pause", admin: ADMIN, target: "rolex-daytona-116500ln", after: true, ip: SECRET_IP },
  { time: "t", action: "deposits.rescan", admin: ADMIN, detail: { credited: 2, scannedTo: 99 }, ip: SECRET_IP },
  // An action nobody has written a projection for yet.
  { time: "t", action: "some.future.action", admin: ADMIN, target: USER_ID,
    detail: { secret: "should never appear", address: USER_WALLET }, ip: SECRET_IP },
];

// ── 1. nothing sensitive escapes, for ANY action ──────────────────────────────
{
  const serialised = JSON.stringify(ROWS.map(publicAuditEntry));

  check("no request IP is ever published", serialised.includes(SECRET_IP), false);
  check("no full user id is ever published", serialised.includes(USER_ID), false);
  check("no user wallet address is published", serialised.includes(USER_WALLET), false);
  check("no full admin address is published", serialised.includes(ADMIN), false);
  check("no raw detail blob leaks through", serialised.includes("should never appear"), false);

  // The default branch is what makes the above hold for actions added later.
  check("unknown action publishes only time/action/admin",
    Object.keys(publicAuditEntry(ROWS[7])).sort(), ["action", "admin", "time"]);
}

// ── 2. what SHOULD be public, is ──────────────────────────────────────────────
// Redaction that also hides the accountability signal would be worse than useless.
{
  const send = publicAuditEntry(ROWS[0]);
  check("send publishes the full destination", send.to, "0x2222222222222222222222222222222222222222");
  check("send publishes the amount", send.amountUsdg, 250);
  check("send publishes the stated reason", send.reason, "support refund");

  const bal = publicAuditEntry(ROWS[2]);
  check("balance edit publishes the delta", bal.deltaUsd, 50);
  check("balance edit publishes the reason", bal.reason, "goodwill");
  check("balance edit truncates the user", bal.user, "3f8a1c…1f90");

  const claim = publicAuditEntry(ROWS[3]);
  check("deposit claim publishes the amount", claim.amountUsdg, 500);

  check("pause state is published", publicAuditEntry(ROWS[4]).withdrawalsPaused, true);
  check("market pause names the market", publicAuditEntry(ROWS[5]).market, "rolex-daytona-116500ln");
}

// ── 3. liabilities cannot be understated ──────────────────────────────────────
{
  memDb.users.length = 0;
  memDb.positions.length = 0;
  memDb.markets.length = 0;

  memDb.markets.push({ id: "m1", index_price: "11000" });
  memDb.users.push({ id: "u1", balance_usd: "400" });
  memDb.users.push({ id: "u2", balance_usd: "100" });

  // A long opened at 10000, now marked at 11000: +10% on 10x notional = +100% ROE.
  memDb.positions.push({
    id: "p1", user_id: "u1", market_id: "m1", status: "open", direction: "long",
    collateral: "100", notional: "1000", entry_price: "10000",
  });

  const claims = totalUserClaims();
  check("wallet balances are counted", claims.userBalances, 500);
  check("locked collateral is counted", claims.openPositionCollateral, 100);
  check("unrealised profit is counted as owed", claims.openPositionUnrealizedPnl, 100);
  check("total is the sum of all three", claims.total, 700);

  // A closed position is not a liability.
  memDb.positions.push({
    id: "p2", user_id: "u2", market_id: "m1", status: "closed", direction: "long",
    collateral: "999", notional: "9990", entry_price: "10000",
  });
  check("closed positions are excluded", totalUserClaims().total, 700);

  // A loss reduces the claim but can never take it below zero, matching clampPnl on the
  // close path — so one blown-up account cannot mask another user's balance.
  memDb.positions.length = 1;
  memDb.markets[0].index_price = "1000"; // -90% against a 10x long
  const wiped = totalUserClaims();
  check("a total loss floors the position claim at zero",
    wiped.openPositionCollateral + wiped.openPositionUnrealizedPnl, 0);
  check("other users' balances are untouched by it", wiped.userBalances, 500);
}

console.log(failed === 0 ? "\ntransparency: all cases as specified" : `\ntransparency: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
