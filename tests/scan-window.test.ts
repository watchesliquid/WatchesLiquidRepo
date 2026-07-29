/**
 * Regression test for deposit scan coverage (audit finding 4).
 *
 * Pure — no server, no chain, no DB file. Run with: npx tsx tests/scan-window.test.ts
 *
 * The bug: the scanner queries `from + 1 … to` and treats the cursor as "last block already
 * scanned", but a cold start seeded the cursor to the first block it WANTED. That block was
 * therefore never queried, and the cursor moved past it on the first tick, so nothing ever went
 * back for it. A USDG transfer landing in it is credited to nobody and is invisible even to the
 * unattributed-deposits list — the scanner simply never sees the log.
 *
 * The property tested here is the one that matters: replaying the real chunk arithmetic over a
 * synthetic chain must visit every block in [firstWanted, safeHead] exactly once.
 */
import { coldStartCursor, chunkRange } from "../keeper/src/services/deposits";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(50)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

/**
 * Replay the scan loop over a fake chain and count how many times each block is queried.
 * Mirrors scanDeposits(): seed the cursor, then walk chunks until the cursor reaches safeHead.
 */
function coverage(firstWanted: number, safeHead: number, chunk: number): Map<number, number> {
  const visits = new Map<number, number>();
  let cursorBlock = coldStartCursor(firstWanted);

  // No MAX_CHUNKS_PER_TICK cap here: that only spreads the same walk across ticks, and the
  // cursor persists between them, so total coverage is unchanged.
  while (cursorBlock < safeHead) {
    const { fromBlock, toBlock } = chunkRange(cursorBlock, safeHead, chunk);
    for (let b = fromBlock; b <= toBlock; b++) visits.set(b, (visits.get(b) ?? 0) + 1);
    cursorBlock = toBlock;
  }
  return visits;
}

function report(label: string, firstWanted: number, safeHead: number, chunk: number): void {
  const visits = coverage(firstWanted, safeHead, chunk);
  const missed: number[] = [];
  const doubled: number[] = [];
  for (let b = firstWanted; b <= safeHead; b++) {
    const n = visits.get(b) ?? 0;
    if (n === 0) missed.push(b);
    if (n > 1) doubled.push(b);
  }
  // A block below firstWanted must never be queried — that would be an unrequested backscan.
  const early = [...visits.keys()].filter((b) => b < firstWanted);

  check(`${label}: no block missed`, missed.slice(0, 5), []);
  check(`${label}: no block scanned twice`, doubled.slice(0, 5), []);
  check(`${label}: nothing scanned before start`, early.slice(0, 5), []);
}

// ── the exact shape of the bug ────────────────────────────────────────────────
// Cold start with EVM_START_BLOCK=1000: block 1000 itself must be queried.
{
  const first = chunkRange(coldStartCursor(1000), 5000, 2000);
  check("EVM_START_BLOCK=1000 scans block 1000", first.fromBlock, 1000);
}

// Default cold start (cursor := safeHead): the head block itself must still be queried.
{
  const safeHead = 21_200_000;
  const first = chunkRange(coldStartCursor(safeHead), safeHead, 2000);
  check("default cold start scans the head block", [first.fromBlock, first.toBlock], [safeHead, safeHead]);
}

// ── full-coverage sweeps ──────────────────────────────────────────────────────
report("exact multiple of chunk", 1_000, 5_000, 2_000);      // ends flush on a chunk boundary
report("ragged tail", 1_000, 5_137, 2_000);                  // last chunk is short
report("single block to scan", 4_663, 4_663, 2_000);         // firstWanted === safeHead
report("two blocks", 4_663, 4_664, 2_000);
report("chunk larger than range", 1_000, 1_050, 2_000);
report("mainnet-scale catch-up", 21_200_000, 21_293_137, 2_000);

// ── boundary guards ───────────────────────────────────────────────────────────
check("cursor never goes negative", coldStartCursor(0), 0);
check("chunk is capped at safeHead", chunkRange(4_000, 4_500, 2_000).toBlock, 4_500);
check("chunk range is contiguous with the next", chunkRange(chunkRange(0, 9_999, 2_000).toBlock, 9_999, 2_000).fromBlock, 2_001);

console.log(failed === 0 ? "\nscan windows: all cases as specified" : `\nscan windows: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
