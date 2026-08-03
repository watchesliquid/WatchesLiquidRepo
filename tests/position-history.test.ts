/**
 * Regression test for GET /api/positions/history.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/position-history.test.ts
 *
 * Source-level, in the same style as admin-surface.test.ts, because the route handler is defined
 * inline on the router and the properties worth pinning are structural.
 *
 * Two of them matter:
 *
 *   1. It must filter on req.userId. This endpoint returns entry price, size, leverage and PnL —
 *      exactly the per-account data the leaderboard leaked once already. A dropped user filter
 *      here would serve every user's trading history to any authenticated caller, and it would
 *      look completely fine in the UI because you would only ever see your own rows in testing.
 *
 *   2. It must be declared before any parameterised route. Express matches in declaration order,
 *      so a "/:id" above it would swallow "/history" as a position whose id is "history" — the
 *      same footgun markets.ts documents for "/stats".
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "keeper", "src", "routes", "positions.ts"), "utf-8");

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(54)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const historyAt = src.indexOf('positionsRouter.get("/history"');
check("the history route exists", historyAt > -1, true);

// The handler body: from its declaration to the next route declaration.
const nextRoute = src.slice(historyAt + 30).search(/positionsRouter\.(get|post|put|patch|delete)\(/);
const handler = src.slice(historyAt, nextRoute > -1 ? historyAt + 30 + nextRoute : src.length);

check("it filters on the requesting user", /p\.user_id === req\.userId/.test(handler), true);
check("it returns only settled positions", /p\.status !== "open"/.test(handler), true);
check("it never returns another user's rows", /user_id === req\.userId/.test(handler), true);
// The card needs entry AND exit on one row; that is the whole reason this route exists.
check("it exposes the entry price", /entryPrice/.test(handler), true);
check("it exposes the close price", /closePrice/.test(handler), true);
check("it exposes realised pnl", /\bpnl\b/.test(handler), true);
check("it distinguishes liquidations", /status: p\.status/.test(handler), true);
// Unbounded history is a slow query and a big response on a JSON store.
check("the result count is bounded", /Math\.min\(/.test(handler), true);

// Declaration order: no parameterised GET may precede it, or Express matches "history" as an id.
{
  const paramGet = src.search(/positionsRouter\.get\("\/:/);
  check("no parameterised GET precedes it", paramGet === -1 || paramGet > historyAt, true);
}

// The balance-adjacent fields have no business on a history row.
check("it does not return a balance", /balance/i.test(handler), false);
check("it does not return a wallet address", /public_key|publicKey/.test(handler), false);

console.log(failed === 0 ? "\nposition history: all cases as specified" : `\nposition history: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
