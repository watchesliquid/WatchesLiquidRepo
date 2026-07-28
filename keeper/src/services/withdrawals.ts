/**
 * Withdrawal risk limits and crash recovery.
 *
 * Two separate jobs that both exist because the wallet is custodial and hot:
 *
 *  1. checkWithdrawLimits() — blast-radius caps. They do not stop an attacker who has found a
 *     genuine balance bug; they bound how much leaves before a human notices.
 *  2. reconcilePendingWithdrawals() — a withdrawal is recorded `pending` BEFORE broadcast, so a
 *     crash between broadcast and receipt leaves a row whose real outcome is unknown. Nothing
 *     re-checked those rows, so a user's balance could stay deducted for a transfer that never
 *     landed (or, worse, be manually "fixed" into a double spend). On boot we ask the chain.
 */
import { memDb, saveDb } from "../db/memory";
import { publicClient } from "./evm";
import {
  WITHDRAW_DAILY_LIMIT_PER_USER,
  WITHDRAW_DAILY_LIMIT_GLOBAL,
  WITHDRAW_MAX_SINGLE,
} from "shared/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Withdrawals that actually moved (or may still move) funds — pending counts against limits. */
function countsAgainstLimit(w: any): boolean {
  return w.status === "confirmed" || w.status === "pending";
}

function sumSince(rows: any[], sinceMs: number): number {
  return rows
    .filter((w) => countsAgainstLimit(w) && new Date(w.time).getTime() >= sinceMs)
    .reduce((s, w) => s + Number(w.amount || 0), 0);
}

export interface LimitVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Called BEFORE any balance is deducted. Pending rows are included in the totals on purpose —
 * excluding them would let concurrent requests each pass a check the other invalidates.
 */
export function checkWithdrawLimits(user: any, amount: number): LimitVerdict {
  if (amount > WITHDRAW_MAX_SINGLE) {
    return { ok: false, reason: `Maximum single withdrawal is ${WITHDRAW_MAX_SINGLE} USDG.` };
  }

  const since = Date.now() - DAY_MS;

  const userTotal = sumSince(user.withdrawals ?? [], since);
  if (userTotal + amount > WITHDRAW_DAILY_LIMIT_PER_USER) {
    const left = Math.max(0, WITHDRAW_DAILY_LIMIT_PER_USER - userTotal);
    return { ok: false, reason: `Daily withdrawal limit reached. ${left.toFixed(2)} USDG remaining today.` };
  }

  const globalTotal = memDb.users.reduce(
    (s: number, u: any) => s + sumSince(u.withdrawals ?? [], since),
    0,
  );
  if (globalTotal + amount > WITHDRAW_DAILY_LIMIT_GLOBAL) {
    // Deliberately vague to the client, loud in the logs: this is the circuit breaker and it
    // tripping is either a very good day or an incident.
    console.error(
      `[withdraw] GLOBAL DAILY LIMIT TRIPPED: ${globalTotal.toFixed(2)} + ${amount} > ${WITHDRAW_DAILY_LIMIT_GLOBAL}`,
    );
    return { ok: false, reason: "Withdrawals temporarily paused. Please try again later." };
  }

  return { ok: true };
}

/**
 * Resolve `pending` rows against the chain on boot.
 *
 * Only three outcomes are safe to act on:
 *   - no txHash        -> never broadcast, restore the balance
 *   - receipt success  -> mark confirmed, balance stays deducted
 *   - receipt reverted -> nothing moved, restore the balance
 * A txHash with no receipt yet is left pending and re-checked next boot. Guessing there is
 * exactly the double-spend this function exists to prevent.
 */
export async function reconcilePendingWithdrawals(): Promise<void> {
  let restored = 0;
  let confirmed = 0;
  let stillPending = 0;

  for (const user of memDb.users as any[]) {
    for (const w of user.withdrawals ?? []) {
      if (w.status !== "pending") continue;

      if (!w.txHash) {
        user.balance_usd = String(Number(user.balance_usd) + Number(w.amount));
        w.status = "failed";
        w.error = "no txHash — never broadcast (recovered on boot)";
        restored++;
        continue;
      }

      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: w.txHash });
        if (receipt.status === "success") {
          w.status = "confirmed";
          confirmed++;
        } else {
          user.balance_usd = String(Number(user.balance_usd) + Number(w.amount));
          w.status = "reverted";
          restored++;
        }
      } catch {
        // Not mined yet, or the RPC cannot see it. Leave it pending — never assume.
        stillPending++;
      }
    }
  }

  if (restored || confirmed || stillPending) {
    saveDb();
    console.log(
      `[withdrawals] reconciled on boot: ${confirmed} confirmed, ${restored} restored, ${stillPending} still pending`,
    );
  }
}
