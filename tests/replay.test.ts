/**
 * Regression test for auth signature replay (audit finding 1).
 *
 * Pure — no server, no chain, no DB file. Run with: npx tsx tests/replay.test.ts
 *
 * The bug: POST /api/auth/wallet issued a fresh 7-day token for ANY correctly-signed message
 * whose timestamp was inside the 5-minute window, however many times it was presented. A
 * captured message was a reusable credential for the rest of that window.
 *
 * Sections are ordered: the store is module-global, and the overflow cases at the end
 * deliberately fill it.
 */
import {
  checkAuthFreshness,
  consumeAuthMessage,
  authReplayStoreSize,
  AUTH_WINDOW_MS,
  AUTH_FUTURE_SKEW_MS,
} from "../keeper/src/services/auth-replay";

const MAX_ENTRIES = 10_000; // must match auth-replay.ts

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const T0 = 1_800_000_000_000;
const msg = (n: number, t = T0) => `watchperps-auth:0x${String(n).padStart(40, "0")}:4663:${t}`;

// ── 1. a message is spendable exactly once ────────────────────────────────────
{
  const m = msg(1);
  check("first use is accepted", consumeAuthMessage(m, T0, T0), true);
  check("replay is refused", consumeAuthMessage(m, T0, T0), false);
  check("replay 1s later still refused", consumeAuthMessage(m, T0, T0 + 1_000), false);
  check("replay near window edge refused", consumeAuthMessage(m, T0, T0 + AUTH_WINDOW_MS - 1), false);

  // A different login by the same wallet is a different message (different timestamp).
  check("same wallet, later timestamp, accepted", consumeAuthMessage(msg(1, T0 + 1), T0 + 1, T0 + 1), true);
  check("a different wallet is unaffected", consumeAuthMessage(msg(2), T0, T0), true);
}

// ── 2. freshness bounds ───────────────────────────────────────────────────────
{
  check("in-window timestamp is fresh", checkAuthFreshness(T0, T0 + 60_000), null);
  check("just inside the window", checkAuthFreshness(T0, T0 + AUTH_WINDOW_MS), null);
  check("just outside the window", checkAuthFreshness(T0, T0 + AUTH_WINDOW_MS + 1), "Auth message expired");

  // The original check was one-sided: `Date.now() - timestamp > WINDOW` passes for anything
  // dated in the future, so a message stamped a year out was valid for a year.
  check("modest clock skew tolerated", checkAuthFreshness(T0 + AUTH_FUTURE_SKEW_MS, T0), null);
  check("far-future timestamp rejected", checkAuthFreshness(T0 + 365 * 86_400_000, T0), "Auth message is dated in the future");

  check("missing timestamp rejected", checkAuthFreshness(0, T0), "Invalid auth message");
  check("NaN timestamp rejected", checkAuthFreshness(NaN, T0), "Invalid auth message");
  check("negative timestamp rejected", checkAuthFreshness(-1, T0), "Invalid auth message");
}

// ── 3. overflow fails closed instead of evicting ──────────────────────────────
// Evicting the oldest entry would restore the exploit: flood the store, push a captured message
// out of it, then replay that message. This is the case that must never regress.
{
  const victim = msg(999_999);
  consumeAuthMessage(victim, T0, T0);

  // Fill to the cap with entries that are all still live at T0.
  let n = 0;
  while (authReplayStoreSize() < MAX_ENTRIES) {
    consumeAuthMessage(msg(1_000_000 + n), T0, T0);
    n++;
  }

  check("store filled to the cap", authReplayStoreSize(), MAX_ENTRIES);
  check("overflow rejects the new message", consumeAuthMessage(msg(2_000_001), T0, T0), false);
  check("the captured message was NOT evicted", consumeAuthMessage(victim, T0, T0), false);
  check("store did not grow past the cap", authReplayStoreSize(), MAX_ENTRIES);
}

// ── 4. expired entries are reclaimed, so a full store recovers on its own ─────
{
  const later = T0 + AUTH_WINDOW_MS + 1;
  check("a fresh login succeeds once entries expire", consumeAuthMessage(msg(3_000_001), later, later), true);
  const size = authReplayStoreSize();
  check("expired entries were pruned", size < MAX_ENTRIES, true);
  console.log(`\n      store held ${MAX_ENTRIES}, pruned to ${size} once the window passed`);
}

console.log(failed === 0 ? "\nreplay: all cases as specified" : `\nreplay: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
