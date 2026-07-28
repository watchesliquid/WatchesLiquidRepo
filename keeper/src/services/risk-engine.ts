import { memDb, saveDb } from "../db/memory";
import { CLOSE_FEE_RATE, LIQUIDATION_FEE } from "shared/constants";
import { evaluatePosition, clampPnl, type CloseReason } from "shared/margin";
import type { Direction } from "shared/types";

/**
 * Force-close any open position that has hit its stop, its take-profit, the profit cap, or
 * its liquidation price. Runs every 15s from index.ts.
 *
 * This previously ran against Drizzle/Postgres while every route used memDb, so the DB call
 * threw on each tick and the error was swallowed by .catch(console.error) — no position was
 * ever liquidated and no funding ever settled.
 */
export async function runLiquidationCheck(): Promise<{ liquidated: number }> {
  const open = memDb.positions.filter((p: any) => p.status === "open");
  let closed = 0;

  for (const position of open) {
    try {
      const market = memDb.markets.find((m: any) => m.id === position.market_id);
      if (!market) continue;

      const markPrice = Number(market.index_price);
      if (!isFinite(markPrice) || markPrice <= 0) continue;

      const { reason } = evaluatePosition({
        entryPrice: Number(position.entry_price),
        markPrice,
        notional: Number(position.notional),
        collateral: Number(position.collateral),
        direction: position.direction as Direction,
        stopLoss: position.stop_loss ? Number(position.stop_loss) : null,
        takeProfit: position.take_profit ? Number(position.take_profit) : null,
      });

      if (!reason) continue;

      closePosition(position, markPrice, reason);
      closed++;
    } catch (err) {
      console.error(`[risk] check failed for position ${position.id}:`, err);
    }
  }

  if (closed > 0) saveDb();
  return { liquidated: closed };
}

function closePosition(position: any, exitPrice: number, reason: CloseReason): void {
  if (position.status !== "open") return;

  const notional = Number(position.notional);
  const collateral = Number(position.collateral);
  const direction = position.direction as Direction;

  const raw = evaluatePosition({
    entryPrice: Number(position.entry_price),
    markPrice: exitPrice,
    notional,
    collateral,
    direction,
    stopLoss: null,
    takeProfit: null,
  }).pnl;

  const pnl = clampPnl(raw, collateral);

  // A liquidation pays the keeper incentive out of whatever equity is left rather than a close
  // fee. At high leverage the fee exceeds the remaining equity, so the credit floors at zero —
  // which is the point: being liquidated costs you the position.
  const fee = reason === "liquidation" ? notional * LIQUIDATION_FEE : notional * CLOSE_FEE_RATE;
  const credit = Math.max(0, collateral + pnl - fee);

  const user = memDb.users.find((u: any) => u.id === position.user_id);
  if (user) user.balance_usd = String(Number(user.balance_usd) + credit);

  position.status = reason === "liquidation" ? "liquidated" : "closed";
  position.closed_at = new Date().toISOString();
  position.close_price = String(exitPrice);
  position.pnl = String(pnl);
  position.close_reason = reason;

  memDb.trades.push({
    id: crypto.randomUUID(),
    user_id: position.user_id,
    market_id: position.market_id,
    position_id: position.id,
    type: reason === "liquidation" ? "liquidate" : "close",
    direction,
    size: String(collateral),
    leverage: position.leverage,
    price: String(exitPrice),
    fee: String(fee),
    pnl: String(pnl),
    created_at: new Date().toISOString(),
  });

  const market = memDb.markets.find((m: any) => m.id === position.market_id);
  if (market) {
    const oiField = direction === "long" ? "open_interest_long" : "open_interest_short";
    market[oiField] = String(Math.max(0, Number(market[oiField]) - notional));
  }

  console.log(
    `[risk] ${reason} ${direction} ${position.market_id} @ ${exitPrice.toFixed(2)} ` +
      `pnl=${pnl.toFixed(2)} fee=${fee.toFixed(2)} credit=${credit.toFixed(2)}`,
  );
}
