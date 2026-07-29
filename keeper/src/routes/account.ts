import { Router } from "express";
import { memDb, saveDb, flushDb } from "../db/memory";
import { authMiddleware } from "./auth";
import {
  getPlatformAddress,
  getUsdgBalance,
  getGasBalance,
  sendUsdg,
  isValidAddress,
  isRpcConfigured,
  isPlatformConfigured,
  getChainConfig,
} from "../services/evm";
import { scanDeposits } from "../services/deposits";
import { checkWithdrawLimits } from "../services/withdrawals";
import { areWithdrawalsPaused } from "../services/audit";
import { normalizeAddress, txUrl } from "shared/chain";

export const accountRouter = Router();

const MIN_WITHDRAW_USDG = 1;
/** Platform needs ETH for gas — USDG cannot pay for its own transfer. */
const MIN_GAS_ETH = 0.0005;

// GET /api/account/deposit-address — public, no auth needed
accountRouter.get("/deposit-address", (_req: any, res) => {
  try {
    const cfg = getChainConfig();
    res.json({
      address: getPlatformAddress(),
      network: cfg.name,
      chainId: cfg.chainId,
      token: "USDG",
      tokenAddress: cfg.usdgAddress,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

accountRouter.use(authMiddleware);

// GET /api/account/balance
accountRouter.get("/balance", (req: any, res) => {
  const user = memDb.users.find((u: any) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ balance: Number(user.balance_usd) });
});

// POST /api/account/deposit/check — force a scan rather than waiting for the 60s cron.
// Deliberately delegates to the same scanner the cron uses: the Solana version kept a second,
// subtly different copy of the scan loop here, which is how the two drifted.
accountRouter.post("/deposit/check", async (req: any, res) => {
  try {
    const user = memDb.users.find((u: any) => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.public_key) {
      return res.json({ walletBalance: 0, internalBalance: Number(user.balance_usd), credited: 0, message: "No wallet connected" });
    }
    if (!isRpcConfigured() || !isPlatformConfigured()) {
      return res.json({ walletBalance: 0, internalBalance: Number(user.balance_usd), credited: 0, message: "Chain not configured" });
    }

    const before = Number(user.balance_usd);
    await scanDeposits();
    const after = Number(user.balance_usd);
    const credited = after - before;

    res.json({
      walletBalance: await getUsdgBalance(user.public_key),
      internalBalance: after,
      credited,
      message: credited > 0 ? `Credited ${credited.toFixed(2)} USDG` : "No new deposits found",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/account/withdraw — send USDG from the platform wallet.
//
// Solana had two outcomes: sendAndConfirmTransaction either returned or threw, so "throw =>
// revert the balance" was safe. EVM has THREE:
//   1. broadcast rejected (bad nonce, no gas)      -> no tx exists, safe to revert
//   2. mined, receipt.status === "success"          -> commit
//   3. mined, receipt.status === "reverted"         -> tx exists but moved nothing, safe to revert
//   4. broadcast OK, confirmation UNKNOWN           -> reverting here is a DOUBLE SPEND
// The old shape collapsed 2/3/4 into one catch. Here the balance is only restored when no
// txHash was ever obtained; anything with a txHash is recorded as pending and reconciled.
accountRouter.post("/withdraw", async (req: any, res) => {
  const user = memDb.users.find((u: any) => u.id === req.userId);
  try {
    const { toAddress, amount } = req.body;
    if (!toAddress || !amount || amount <= 0) {
      return res.status(400).json({ error: "Valid toAddress and amount required" });
    }
    if (!isValidAddress(toAddress)) {
      return res.status(400).json({ error: "Invalid address — expected a 0x… EVM address" });
    }
    if (amount < MIN_WITHDRAW_USDG) {
      return res.status(400).json({ error: `Minimum withdraw: ${MIN_WITHDRAW_USDG} USDG` });
    }
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!isPlatformConfigured()) return res.status(503).json({ error: "Platform wallet not configured" });

    // Admin kill switch. Checked before every other withdrawal condition so that pausing is
    // absolute — a switch that only applies to some requests is not a kill switch.
    if (areWithdrawalsPaused()) {
      return res.status(503).json({ error: "Withdrawals are temporarily paused. Please try again later." });
    }

    // Per-user lock: stops one user double-spending their own balance. The platform wallet's
    // nonce is protected separately by the send queue in evm.ts — different problem.
    if ((user as any)._withdrawing) {
      return res.status(429).json({ error: "Withdrawal in progress, try again" });
    }
    (user as any)._withdrawing = true;

    if (Number(user.balance_usd) < amount) {
      (user as any)._withdrawing = false;
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Blast-radius caps (per-tx, per-user/day, global/day). Checked after the balance check so
    // a user without the funds gets the accurate error, and before any deduction.
    const limit = checkWithdrawLimits(user, amount);
    if (!limit.ok) {
      (user as any)._withdrawing = false;
      return res.status(429).json({ error: limit.reason });
    }

    // RESERVE THE BALANCE NOW, in the same synchronous block as the check above.
    //
    // This used to pre-flight gas first and deduct afterwards, which opened a TOCTOU window: the
    // `await` below yields the event loop for a full RPC round-trip, and POST /positions/open is
    // synchronous, so it ran to completion inside that window against a balance this request had
    // already approved for withdrawal. A user could withdraw their balance on-chain AND open a
    // position with it, leaving balance_usd negative and the platform short the difference.
    // `_withdrawing` did not help — it only serialises withdrawals against each other.
    //
    // Nothing may await between reading balance_usd and writing it. Node is single-threaded, so
    // a synchronous check-and-deduct is atomic; an await in the middle is not.
    user.balance_usd = String(Number(user.balance_usd) - amount);
    if (!user.withdrawals) user.withdrawals = [];
    const record: any = { to: normalizeAddress(toAddress), amount, status: "pending", txHash: null, time: new Date().toISOString() };
    user.withdrawals.push(record);

    // flushDb, NOT saveDb. Recording `pending` before broadcast is the entire safety design of
    // this route — it is what lets the reconciler resolve a crash mid-send. saveDb defers the
    // write 200ms, so a crash inside that window meant the transfer went out with no record of
    // it and no debit on disk: the user kept the balance and the funds. Writing synchronously
    // here is the difference between a design and a comment describing one.
    //
    // If the write fails we must not broadcast. Releasing the reservation and refusing is the
    // only safe answer: an unrecorded outbound transfer is exactly what this prevents.
    try {
      flushDb();
    } catch (err: any) {
      user.balance_usd = String(Number(user.balance_usd) + amount);
      user.withdrawals.pop();
      (user as any)._withdrawing = false;
      console.error("[withdraw] could not persist the pending record, refusing to send:", err.message);
      return res.status(503).json({ error: "Withdrawals temporarily unavailable (storage)" });
    }

    // Gas pre-flight. An unfunded platform wallet fails every send, so refuse before broadcasting
    // — but the balance is already reserved, so release it explicitly on this path.
    const gas = await getGasBalance(getPlatformAddress());
    if (gas < MIN_GAS_ETH) {
      user.balance_usd = String(Number(user.balance_usd) + amount);
      record.status = "failed";
      record.error = `platform gas ${gas} below ${MIN_GAS_ETH}`;
      saveDb();
      (user as any)._withdrawing = false;
      console.error(`[withdraw] platform ETH ${gas} below ${MIN_GAS_ETH} — reservation released`);
      return res.status(503).json({ error: "Withdrawals temporarily unavailable (platform gas)" });
    }

    let result;
    try {
      // Persist the hash the moment it exists, before the receipt wait. Without this there is a
      // seconds-long window where the transfer is confirming on-chain but the row still says
      // txHash: null — which reconcileWithdrawal reads as "never broadcast" and refunds, on top
      // of a transfer that actually went out.
      result = await sendUsdg(toAddress, amount, (txHash) => {
        record.txHash = txHash;
        flushDb();
      });
    } catch (sendErr: any) {
      // "Threw" no longer implies "nothing was broadcast": the onBroadcast callback above runs
      // AFTER the transfer is on the wire, so if persisting the hash fails, this catch is
      // reached with a live transaction. Restoring the balance there would refund a withdrawal
      // that is about to confirm. Decide from the record, not from the fact that we threw.
      if (record.txHash) {
        record.status = "pending";
        record.error = `send threw after broadcast: ${sendErr.message}`;
        saveDb();
        (user as any)._withdrawing = false;
        console.error(`[withdraw] broadcast ${record.txHash} then threw — left pending for the reconciler:`, sendErr.message);
        return res.status(500).json({
          error: "Transaction was broadcast but its result is unconfirmed. It will be reconciled automatically.",
          txHash: record.txHash,
        });
      }

      // No txHash => nothing is on-chain => restoring is correct.
      user.balance_usd = String(Number(user.balance_usd) + amount);
      record.status = "failed";
      record.error = sendErr.message;
      saveDb();
      (user as any)._withdrawing = false;
      return res.status(500).json({ error: `Transaction failed: ${sendErr.message}. Balance restored.` });
    }

    record.txHash = result.txHash;

    if (result.status === "reverted") {
      // Mined but moved nothing. viem does NOT throw for this — the old code would have
      // reported success.
      user.balance_usd = String(Number(user.balance_usd) + amount);
      record.status = "reverted";
      saveDb();
      (user as any)._withdrawing = false;
      return res.status(500).json({ error: "Transaction reverted on-chain. Balance restored.", txHash: result.txHash });
    }

    record.status = "confirmed";
    saveDb();
    (user as any)._withdrawing = false;

    res.json({
      txHash: result.txHash,
      explorerUrl: txUrl(getChainConfig(), result.txHash),
      newBalance: Number(user.balance_usd),
    });
  } catch (err: any) {
    if (user) (user as any)._withdrawing = false;
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account/withdrawals — list past withdrawals
accountRouter.get("/withdrawals", (req: any, res) => {
  const user = memDb.users.find((u: any) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ withdrawals: user.withdrawals ?? [] });
});

// GET /api/account/trades
accountRouter.get("/trades", (req: any, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const userTrades = memDb.trades
    .filter((t: any) => t.user_id === req.userId)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const paged = userTrades.slice(offset, offset + limit);

  res.json({
    trades: paged.map((t: any) => ({
      id: t.id,
      userId: t.user_id,
      marketId: t.market_id,
      positionId: t.position_id,
      type: t.type,
      direction: t.direction,
      size: Number(t.size),
      leverage: t.leverage,
      price: Number(t.price),
      fee: Number(t.fee),
      pnl: Number(t.pnl),
      createdAt: t.created_at,
    })),
    total: userTrades.length,
  });
});
