// Deposit dedupe keys (`txHash:logIndex`) — membership index and retention.
//
// The keys must stay on the user row: `data/watchperps.json` is the only copy of who has been
// credited what, and losing it means re-crediting every deposit ever made. What changes here is
// how they are searched and how many are kept.
//
// Three problems with the bare array:
//   1. `user.credited_txs.includes(key)` is O(n), run once per Transfer log per scan tick.
//   2. It grows without bound — nothing ever removed a key.
//   3. It lives inside the single JSON blob that memory.ts re-serialises IN FULL on every save
//      (debounced 200ms, plus a 10s autosave). Every key ever credited was being rewritten to
//      disk every 10 seconds, forever.
//
// Membership now goes through a Set, and the stored history is bounded. See MAX_KEYS for why
// dropping old keys cannot double-credit anyone.

/**
 * How many recent dedupe keys to keep per user.
 *
 * Safe to prune because re-crediting a transfer requires the scanner to SEE its log again, and
 * the block cursor only moves forward: a rescan only ever revisits the chunk that was in flight
 * when the process died (2000 blocks ~= 200s at 100ms blocks). A key this far back — 1000
 * deposits ago — is many orders of magnitude outside any window the scanner can revisit.
 *
 * The one way the cursor goes backwards is an operator setting EVM_START_BLOCK to a past block
 * to re-scan history. That is exactly when full dedupe history matters, so pruning switches off
 * when that variable is set. See shouldPrune().
 */
const MAX_KEYS = 1000;

/** userId -> its credited keys. Rebuilt on demand; never the source of truth. */
const index = new Map<string, Set<string>>();

/**
 * Pruning is disabled whenever a manual rescan is configured. Read once at module load — the
 * deposit scanner reads it the same way, and changing it means a restart either way.
 */
const MANUAL_RESCAN_CONFIGURED = Boolean(process.env.EVM_START_BLOCK);

function keysOf(user: any): Set<string> {
  if (!user.credited_txs) user.credited_txs = [];

  let set = index.get(user.id);

  // Rebuild when the two disagree on size. loadDb() replaces the whole users array on boot, so
  // the index must not outlive it, and this catches any path that pushes to the array directly.
  // The comparison is O(1); the rebuild is O(n) but happens once per user per restart.
  if (!set || set.size !== user.credited_txs.length) {
    set = new Set<string>(user.credited_txs);
    // Collapse duplicates if any ever got in. Without this the size check above could never
    // agree again and every lookup would rebuild — slower than the O(n) scan being replaced.
    if (set.size !== user.credited_txs.length) user.credited_txs = [...set];
    index.set(user.id, set);
  }

  return set;
}

/** Has this transfer already been credited to this user? O(1). */
export function hasCreditedTx(user: any, key: string): boolean {
  return keysOf(user).has(key);
}

/**
 * Mark a transfer as credited. Idempotent — returns false if the key was already recorded, so
 * callers can use it as a check-and-set rather than testing separately.
 *
 * Callers must still credit the balance and saveDb() themselves; this only touches the keys.
 */
export function recordCreditedTx(user: any, key: string): boolean {
  const set = keysOf(user);
  if (set.has(key)) return false;

  set.add(key);
  user.credited_txs.push(key);

  // Lifetime count, kept separately so pruning does not make the admin panel under-report.
  user.credited_tx_count = Number(user.credited_tx_count ?? user.credited_txs.length - 1) + 1;

  if (!MANUAL_RESCAN_CONFIGURED && user.credited_txs.length > MAX_KEYS) {
    const dropped = user.credited_txs.splice(0, user.credited_txs.length - MAX_KEYS);
    for (const old of dropped) set.delete(old);
  }

  return true;
}

/** Lifetime number of deposits credited, for display. Falls back to the retained keys. */
export function creditedTxCount(user: any): number {
  return Number(user.credited_tx_count ?? (user.credited_txs ?? []).length);
}
