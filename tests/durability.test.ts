/**
 * Regression test for write durability on the money paths.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/durability.test.ts
 *
 * The bug this pins: the withdrawal route records a withdrawal as `pending` BEFORE broadcasting,
 * so that a crash mid-send leaves a row the reconciler can resolve. That design was defeated by
 * saveDb being debounced 200ms — a crash inside the window meant the transfer went out with no
 * record of it and no debit on disk, so the user kept the balance and the funds. The reconciler
 * could not help, because there was no row to reconcile.
 *
 * The distinction that matters, and that must not be flattened back:
 *   deposits  — replayable. A lost write is re-scanned and re-credited. saveDb is fine.
 *   withdrawals — not replayable. The chain does not un-send. flushDb, synchronously.
 */
import { readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// memory.ts resolves DB_PATH from process.cwd() at module load, so the chdir has to happen
// before the import — which is why this is a dynamic import inside main() rather than a static
// one at the top. The scratch directory means the test can never touch a real balances file.
const scratch = join(root, "keeper", ".durability-test");
const DB_FILE = join(scratch, "data", "watchperps.json");

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const onDisk = () => (existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf-8")) : null);

async function main() {
if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
mkdirSync(join(scratch, "data"), { recursive: true });
process.chdir(scratch);

const { memDb, saveDb, flushDb } = await import("../keeper/src/db/memory");

// ── 1. saveDb does not reach disk immediately ─────────────────────────────────
// Not a defect — it is why the debounce exists — but it is the reason the withdrawal path
// cannot use it. If this ever starts passing synchronously, the flush below is load-bearing
// for a reason that no longer exists and someone should re-read both call sites.
{
  memDb.users.push({ id: "u1", balance_usd: "100" });
  saveDb();
  check("saveDb has not written yet", onDisk(), null);
}

// ── 2. flushDb writes synchronously ───────────────────────────────────────────
{
  flushDb();
  const disk = onDisk();
  check("flushDb wrote immediately", disk?.users?.[0]?.id, "u1");
  check("flushDb persisted the balance", disk?.users?.[0]?.balance_usd, "100");
}

// ── 3. a pending withdrawal is on disk before any broadcast could happen ───────
// This is the actual invariant: at the moment sendUsdg is called, the row must already exist on
// disk with the balance debited. Simulated here as the route sequences it.
{
  const user = memDb.users[0] as any;
  user.balance_usd = String(Number(user.balance_usd) - 40);
  user.withdrawals = [{ to: "0xabc", amount: 40, status: "pending", txHash: null, time: "t" }];
  flushDb(); // <- the route does this BEFORE sendUsdg

  const disk = onDisk();
  check("debit is durable pre-broadcast", disk?.users?.[0]?.balance_usd, "60");
  check("pending row is durable pre-broadcast", disk?.users?.[0]?.withdrawals?.[0]?.status, "pending");
  check("row has no txHash yet", disk?.users?.[0]?.withdrawals?.[0]?.txHash, null);
}

// ── 4. the txHash is durable before the receipt wait ──────────────────────────
// sendUsdg's onBroadcast fires between "on the wire" and "awaiting receipt". Without it, a crash
// during the wait leaves pending+null, which reconcileWithdrawal reads as "never broadcast" and
// refunds — on top of a transfer that is confirming.
{
  const user = memDb.users[0] as any;
  user.withdrawals[0].txHash = "0xdeadbeef"; // what onBroadcast does
  flushDb();

  check("txHash is durable before the receipt wait", onDisk()?.users?.[0]?.withdrawals?.[0]?.txHash, "0xdeadbeef");
  check("status is still pending", onDisk()?.users?.[0]?.withdrawals?.[0]?.status, "pending");
}

// ── 5. flushDb cancels the pending debounce rather than racing it ─────────────
// If it did not, a stale debounced write could land after the flush and undo it.
{
  const user = memDb.users[0] as any;
  user.balance_usd = "999";
  saveDb();   // schedules a write
  flushDb();  // must cancel it and write now
  user.balance_usd = "111"; // mutate again; no save called

  await new Promise((r) => setTimeout(r, 400)); // longer than the 200ms debounce
  check("no stale debounced write landed", onDisk()?.users?.[0]?.balance_usd, "999");
}

// ── 6. the call sites are wired the way this test assumes ─────────────────────
{
  const account = readFileSync(join(root, "keeper", "src", "routes", "account.ts"), "utf-8");
  const evm = readFileSync(join(root, "keeper", "src", "services", "evm.ts"), "utf-8");

  // Ordering, not proximity: a gas pre-flight and its error handling sit between the two, and
  // that gap is free to grow. What must never change is which one comes first.
  const firstFlush = account.indexOf("flushDb()");
  const theSend = account.indexOf("sendUsdg(");
  check("withdraw flushes before sending", firstFlush !== -1 && theSend !== -1 && firstFlush < theSend, true);
  check("withdraw persists the hash via onBroadcast", /sendUsdg\([\s\S]{0,300}record\.txHash = txHash;[\s\S]{0,80}flushDb\(\)/.test(account), true);
  check("sendUsdg calls onBroadcast before awaiting the receipt", /onBroadcast\(txHash\)[\s\S]{0,200}waitForTransactionReceipt/.test(evm), true);
  // "threw" no longer implies "nothing broadcast" — the catch must check the record.
  check("catch does not blind-refund after a broadcast", /if \(record\.txHash\)/.test(account), true);
}

// ── 7. a throwing gas pre-flight releases the reservation ─────────────────────
// getGasBalance is an RPC call and the single configured endpoint really does fail (observed:
// 429, and an upstream timeout). The throw used to land in the route's outer catch, which does
// not restore — so the user was debited against a pending/no-txHash row until the reconciler's
// next pass, and before that sweep ran on a timer, until someone restarted the process.
//
// Restoring is safe here and ONLY here: nothing has been broadcast, so there is no transfer this
// could refund on top of. That is the whole distinction, so both halves are pinned.
{
  const account = readFileSync(join(root, "keeper", "src", "routes", "account.ts"), "utf-8");
  const restore = "user.balance_usd = String(Number(user.balance_usd) + amount)";

  const gasAt = account.indexOf("getGasBalance(");
  const sendAt = account.indexOf("sendUsdg(");
  const preflight = account.slice(gasAt, sendAt);

  check("the gas pre-flight is inside a try", /catch/.test(preflight), true);
  // Two release paths before any broadcast: the read threw, and the wallet is too poor to send.
  check("both pre-broadcast paths release the reservation", preflight.split(restore).length - 1, 2);

  // The inverse, and the more dangerous direction: after sendUsdg, "threw" does not imply
  // "nothing was broadcast". A restore in the outer catch would refund a live transfer.
  const outer = account.slice(account.indexOf("} catch (err: any) {", sendAt));
  check("the outer catch still does NOT restore", outer.includes(restore), false);
}

// Back to the real cwd BEFORE the last section. That section imports withdrawals.ts, and
// importing anything while cwd is the scratch directory leaves Windows holding a handle on it,
// so the rmSync below fails with EPERM and takes the whole `npm run check` chain down with it.
// memory.ts resolved DB_PATH at its own import above and is cached, so this cannot redirect it.
process.chdir(root);

// ── 8. the reconciler is a backstop, not the primary fix ──────────────────────
// It recovers a pending row that never got a txHash. Section 7 exists so this is not the only
// thing standing between an RPC hiccup and a user's balance.
{
  const { reconcileWithdrawal } = await import("../keeper/src/services/withdrawals");
  const user: any = { id: "u2", balance_usd: "60", withdrawals: [] };
  const row: any = { to: "0xabc", amount: 40, status: "pending", txHash: null, time: "t" };
  user.withdrawals.push(row);

  const outcome = await reconcileWithdrawal(user, row);
  check("a never-broadcast row is restored", outcome, "restored");
  check("the balance comes back", user.balance_usd, "100");
  check("the row is marked failed, not pending", row.status, "failed");

  // Idempotence: the sweep is overlap-guarded, but a second pass must not pay twice regardless.
  const again = await reconcileWithdrawal(user, row);
  check("a second pass is a no-op", again, "not-pending");
  check("the balance is not credited twice", user.balance_usd, "100");
}

// maxRetries because Windows can still be releasing handles from the imports above; without it
// a transient EPERM here fails a run in which every assertion passed.
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

main().then(() => {
  console.log(failed === 0 ? "\ndurability: all cases as specified" : `\ndurability: ${failed} case(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});
