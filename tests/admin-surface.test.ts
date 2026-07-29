/**
 * Regression test for the admin router's write surface.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/admin-surface.test.ts
 *
 * The property: no route on /api/admin may move funds or create a balance.
 *
 * POST /admin/send and POST /admin/users/:id/balance were removed because together they were a
 * complete value-creation path — a balance written by the second could be withdrawn as real
 * USDG through /account/withdraw, so any stolen admin session was a mint. This test fails if
 * either comes back, or if a new mutating route appears that nobody has consciously allowed.
 *
 * It inspects the Express router stack rather than making HTTP calls, so it needs no server and
 * cannot be fooled by a route that happens to 500 in a test environment.
 */
import { adminRouter } from "../keeper/src/routes/admin";

/**
 * Mutating admin routes that are known and accepted. Adding to this list is a deliberate act —
 * if you are here because the test failed, the question to answer is whether the new route can
 * increase what a user is owed. If it can, it does not belong on this list.
 */
const ALLOWED_MUTATIONS = new Set([
  "POST /withdrawals/pause",
  "POST /markets/:id/pause",
  "POST /deposits/rescan",
  // Bounded by a Transfer that actually arrived on-chain: the amount is read from the stored
  // log, never from the request body, so it cannot credit value that was not deposited. Kept
  // because without it a deposit sent from an exchange is unreachable by its owner forever.
  "POST /deposits/:key/claim",
  // Re-runs the automatic reconciler against ONE withdrawal. The caller picks which row; the
  // chain decides the outcome. No amount, no destination, no outcome parameter — it cannot
  // reach a result the 2-minute sweep would not have reached on its own.
  "POST /withdrawals/recheck",
]);

/** Routes that must NOT exist, by name, so their removal is asserted and not merely implied. */
const FORBIDDEN = ["POST /send", "POST /users/:id/balance"];

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(50)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// Express keeps each registered route on the router stack as layer.route.
const routes: string[] = [];
for (const layer of (adminRouter as any).stack ?? []) {
  const route = layer?.route;
  if (!route?.path) continue;
  for (const method of Object.keys(route.methods ?? {})) {
    if (route.methods[method]) routes.push(`${method.toUpperCase()} ${route.path}`);
  }
}

check("the router exposes routes at all", routes.length > 0, true);

// ── 1. the removed routes are gone ────────────────────────────────────────────
for (const gone of FORBIDDEN) {
  check(`removed: ${gone}`, routes.includes(gone), false);
}

// ── 2. no unreviewed mutating route ───────────────────────────────────────────
const mutations = routes.filter((r) => !r.startsWith("GET "));
const unexpected = mutations.filter((r) => !ALLOWED_MUTATIONS.has(r));
check("every mutating route is on the allowlist", unexpected, []);

// ── 3. the read surface still works ───────────────────────────────────────────
// A panel that shows nothing is not the goal; stats must survive.
for (const needed of ["GET /overview", "GET /users", "GET /withdrawals", "GET /audit"]) {
  check(`read route intact: ${needed}`, routes.includes(needed), true);
}

// ── 4. the router must not even import a transfer primitive ───────────────────
// Belt and braces: catches a re-added send before it is wired to a path.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "keeper", "src", "routes", "admin.ts"), "utf-8");
const importsSend = /^\s*sendUsdg,?\s*$/m.test(source) || /\bsendUsdg\s*\(/.test(source);
check("admin.ts does not import or call sendUsdg", importsSend, false);

console.log("");
console.log(`      admin surface: ${routes.filter((r) => r.startsWith("GET ")).length} read, ${mutations.length} mutating`);
for (const m of mutations.sort()) console.log(`        ${m}`);

console.log(failed === 0 ? "\nadmin surface: all cases as specified" : `\nadmin surface: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
