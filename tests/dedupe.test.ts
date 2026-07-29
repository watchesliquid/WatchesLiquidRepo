/**
 * Regression test for deposit dedupe retention (audit finding 3).
 *
 * Pure — no server, no chain, no DB file. Run with: npx tsx tests/dedupe.test.ts
 *
 * What must hold, in order of how much money it costs to get wrong:
 *   1. A key that was recorded is never credited twice.
 *   2. Pruning old keys never resurrects a recent one.
 *   3. The lifetime deposit count the admin panel shows survives pruning.
 *   4. The in-memory index self-heals when the user row is replaced underneath it (loadDb
 *      swaps the whole users array on boot) or written to directly.
 */
import { hasCreditedTx, recordCreditedTx, creditedTxCount } from "../keeper/src/db/credited-txs";

const MAX_KEYS = 1000; // must match credited-txs.ts

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const key = (n: number) => `0x${String(n).padStart(64, "0")}:0`;

// ── 1. basic check-and-set ─────────────────────────────────────────────────────
{
  const user: any = { id: "u1", balance_usd: "0" };

  check("unseen key is not credited", hasCreditedTx(user, key(1)), false);
  check("first record claims the key", recordCreditedTx(user, key(1)), true);
  check("key now reads as credited", hasCreditedTx(user, key(1)), true);
  check("second record is refused", recordCreditedTx(user, key(1)), false);
  check("refused record did not duplicate", user.credited_txs.length, 1);
  check("lifetime count is 1", creditedTxCount(user), 1);
}

// ── 2. the batch-transfer case that broke the Solana rail ──────────────────────
// One tx carrying several transfers to the same address: same txHash, different logIndex.
{
  const user: any = { id: "u2", balance_usd: "0" };
  const tx = `0x${"ab".repeat(32)}`;
  for (let i = 0; i < 9; i++) recordCreditedTx(user, `${tx}:${i}`);

  check("9 transfers in one tx all credited", user.credited_txs.length, 9);
  check("re-scanning that tx credits nothing", [0, 3, 8].map((i) => recordCreditedTx(user, `${tx}:${i}`)), [false, false, false]);
}

// ── 3. pruning is bounded and does not resurrect recent keys ───────────────────
{
  const user: any = { id: "u3", balance_usd: "0" };
  const total = MAX_KEYS + 500;
  for (let i = 0; i < total; i++) recordCreditedTx(user, key(i));

  check("retained keys are capped", user.credited_txs.length, MAX_KEYS);
  check("lifetime count is not capped", creditedTxCount(user), total);

  // The newest keys must still dedupe — this is the one that costs real money.
  const recent = [total - 1, total - 2, total - MAX_KEYS];
  check("recent keys still dedupe", recent.map((i) => recordCreditedTx(user, key(i))), [false, false, false]);

  // The oldest ones are gone by design. Documented and safe: the block cursor only moves
  // forward, so the scanner can never present a log from 1500 deposits ago again.
  check("oldest key was pruned", hasCreditedTx(user, key(0)), false);
}

// ── 4. index self-heals when the row is replaced or written to directly ────────
{
  const user: any = { id: "u4", balance_usd: "0" };
  recordCreditedTx(user, key(1));
  recordCreditedTx(user, key(2));

  // Simulates loadDb(): same user id, a fresh object and array read back from disk.
  const reloaded: any = { id: "u4", balance_usd: "0", credited_txs: [key(1), key(2), key(3)] };
  check("key written by another path is seen", hasCreditedTx(reloaded, key(3)), true);
  check("re-crediting it is refused", recordCreditedTx(reloaded, key(3)), false);

  // A shorter array than the index also has to rebuild, not go stale in the other direction.
  const truncated: any = { id: "u4", balance_usd: "0", credited_txs: [key(1)] };
  check("truncated row rebuilds the index", hasCreditedTx(truncated, key(3)), false);
}

// ── 5. duplicates in stored data collapse instead of thrashing the index ───────
{
  const user: any = { id: "u5", balance_usd: "0", credited_txs: [key(1), key(1), key(2)] };
  check("duplicate is still deduped", recordCreditedTx(user, key(1)), false);
  check("stored duplicates collapsed", user.credited_txs.length, 2);
}

// ── 6. lookup cost, reported not asserted ─────────────────────────────────────
{
  const user: any = { id: "u6", balance_usd: "0" };
  const n = 50_000;
  const started = Date.now();
  for (let i = 0; i < n; i++) recordCreditedTx(user, key(i));
  for (let i = 0; i < n; i++) hasCreditedTx(user, key(i));
  console.log(`\n      ${n} records + ${n} lookups in ${Date.now() - started}ms (was O(n) per lookup)`);
}

console.log(failed === 0 ? "\ndedupe: all cases as specified" : `\ndedupe: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
