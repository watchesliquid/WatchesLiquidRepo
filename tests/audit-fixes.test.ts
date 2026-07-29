/**
 * Regression test for the 2026-07-29 audit findings.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/audit-fixes.test.ts
 *
 * Four findings, none of which announce themselves when they regress: a bypassed rate limiter
 * still returns 200s, a negative balance still renders, and a leaked balance looks like a
 * leaderboard.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { memDb } from "../keeper/src/db/memory";
import { settleFunding } from "../keeper/src/services/funding";
import { totalUserClaims } from "../keeper/src/routes/transparency";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

async function main() {
  // ── 1. funding may not drive a balance below zero ────────────────────────────
  // Charged on NOTIONAL, so at 50x a $100 position owes $5 an interval — and an account with
  // all its collateral deployed has a $0 wallet. It used to just go negative and keep going,
  // walking past isolated margin and leaving debt that is abandonable for the price of a new
  // wallet, while the other side was credited real withdrawable USDG.
  {
    memDb.markets.length = 0; memDb.users.length = 0;
    memDb.positions.length = 0; memDb.fundingPayments.length = 0;

    memDb.markets.push({
      id: "m1", is_active: true, index_price: "10000",
      open_interest_long: "5000", open_interest_short: "0",
      funding_rate: "0", last_funding_time: new Date(Date.now() - 9 * 3600_000).toISOString(),
    });
    memDb.users.push({ id: "payer", balance_usd: "0" });
    memDb.positions.push({
      id: "p1", user_id: "payer", market_id: "m1", status: "open",
      direction: "long", collateral: "100", notional: "5000", entry_price: "10000",
    });

    for (let i = 0; i < 3; i++) {
      memDb.markets[0].last_funding_time = new Date(Date.now() - 9 * 3600_000).toISOString();
      await settleFunding();
    }

    check("balance never goes negative", Number(memDb.users[0].balance_usd) >= 0, true);
    check("the uncollected amount is recorded", memDb.fundingPayments.some((f: any) => Number(f.shortfall) < 0), true);
    check("the owed amount is still recorded in full", Number(memDb.fundingPayments[0].payment), -5);
  }

  // A payer who CAN afford it must still be charged in full — the floor must not become a
  // blanket excuse from funding.
  {
    memDb.users.length = 0; memDb.positions.length = 0; memDb.fundingPayments.length = 0;
    memDb.users.push({ id: "solvent", balance_usd: "100" });
    memDb.positions.push({
      id: "p2", user_id: "solvent", market_id: "m1", status: "open",
      direction: "long", collateral: "100", notional: "5000", entry_price: "10000",
    });
    memDb.markets[0].last_funding_time = new Date(Date.now() - 9 * 3600_000).toISOString();
    await settleFunding();

    check("a solvent payer is charged in full", Number(memDb.users[0].balance_usd), 95);
    check("no shortfall recorded for them", Number(memDb.fundingPayments[0].shortfall), 0);
  }

  // Partial collection: pay what is there, record the rest.
  {
    memDb.users.length = 0; memDb.positions.length = 0; memDb.fundingPayments.length = 0;
    memDb.users.push({ id: "partial", balance_usd: "2" });
    memDb.positions.push({
      id: "p3", user_id: "partial", market_id: "m1", status: "open",
      direction: "long", collateral: "100", notional: "5000", entry_price: "10000",
    });
    memDb.markets[0].last_funding_time = new Date(Date.now() - 9 * 3600_000).toISOString();
    await settleFunding();

    check("partial payment drains to zero, not below", Number(memDb.users[0].balance_usd), 0);
    check("the remainder is recorded", Number(memDb.fundingPayments[0].shortfall), -3);
  }

  // ── 2. proof of reserves may not be flattered by unpayable debt ──────────────
  {
    memDb.users.length = 0; memDb.positions.length = 0;
    memDb.users.push({ id: "honest", balance_usd: "1000" });
    const before = totalUserClaims().total;

    memDb.users.push({ id: "abandoned", balance_usd: "-15" });
    const after = totalUserClaims().total;

    check("a debt does not reduce reported liabilities", after >= before, true);
    check("liabilities stay at the real figure", after, 1000);
  }

  // ── 3. the rate limiter must key on req.ip ───────────────────────────────────
  // nginx sets X-Forwarded-For with $proxy_add_x_forwarded_for, which APPENDS the real address
  // to whatever the caller sent — so the first entry is attacker-controlled and reading it made
  // every limit in the system decorative.
  {
    const rl = read("keeper", "src", "middleware", "rate-limit.ts");
    const code = rl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    check("does not read the forwarded header", /x-forwarded-for/i.test(code), false);
    check("keys on req.ip", /req\.ip/.test(code), true);

    // trust proxy is what makes req.ip correct; without it this fix is wrong in the other direction.
    check("trust proxy is still configured", /trust proxy/.test(read("keeper", "src", "index.ts")), true);
  }

  // ── 4. the public leaderboard must not publish balances or ids ───────────────
  // It returned pnl and roi where roi = pnl / balance, so balance = pnl * 100 / roi — exactly
  // solvable for every account on the board, unauthenticated.
  {
    const lb = read("keeper", "src", "routes", "leaderboard.ts");
    const code = lb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    check("roi is not derived from balance_usd", /balance_usd/.test(code), false);
    check("the raw userId is not returned", /^\s*userId,/m.test(code), false);
    check("a pseudonym is returned instead", /trader:/.test(code), true);
  }

  // ── 5. the keeper binds to loopback ──────────────────────────────────────────
  // Reaching :3001 directly skips nginx, which is the only thing that makes any forwarded
  // header meaningful in the first place.
  {
    const index = read("keeper", "src", "index.ts");
    check("listen binds an explicit host", /app\.listen\(PORT, HOST/.test(index), true);
    check("the default host is loopback", /BIND_HOST \?\? "127\.0\.0\.1"/.test(index), true);
  }
}

main().then(() => {
  console.log(failed === 0 ? "\naudit fixes: all cases as specified" : `\naudit fixes: ${failed} case(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});
