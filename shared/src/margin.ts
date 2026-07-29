import { MAINTENANCE_MARGIN_RATIO, PROFIT_CAP_ROE } from './constants';
import type { Direction } from './types';

// Single source of truth for margin math.
//
// This exists because there were two contradictory liquidation rules in the codebase:
//
//   1. risk-engine liquidated when equity/NOTIONAL < 0.05. At entry that ratio is exactly
//      1/leverage, so any position above 20x was already below the threshold the moment it
//      opened — every position in a 25x+ market would have been liquidated instantly. It never
//      fired only because risk-engine talked to a Postgres instance that isn't there.
//   2. calcLiqPrice — entry × (1 ∓ 0.95/leverage) — liquidates when equity falls to 5% of
//      COLLATERAL. This is the rule the UI renders as liquidationPrice and the docs publish.
//
// Rule 2 wins: it is the shipped, user-visible contract, and it works at the 50x cap.
// Everything below derives from it. Do not reintroduce a notional-based maintenance rule
// without also lowering MAINTENANCE_MARGIN_RATIO to ~1/MAX_LEVERAGE.

/** Liquidation price — the formula published in the docs and shown in the UI. */
export function calcLiqPrice(entryPrice: number, leverage: number, direction: Direction): number {
  const move = (1 - MAINTENANCE_MARGIN_RATIO) / leverage; // 0.95/lev
  return direction === 'long' ? entryPrice * (1 - move) : entryPrice * (1 + move);
}

/** Unrealised PnL in USD. Scale-invariant: depends on the return, not the absolute price. */
export function computePnl(
  entryPrice: number,
  markPrice: number,
  notional: number,
  direction: Direction,
): number {
  const r = (markPrice - entryPrice) / entryPrice;
  return (direction === 'long' ? r : -r) * notional;
}

/** Account equity backing the position. */
export function computeEquity(collateral: number, pnl: number): number {
  return collateral + pnl;
}

/** Return on equity, as a fraction (3.0 = +300%). */
export function computeRoe(pnl: number, collateral: number): number {
  return collateral > 0 ? pnl / collateral : 0;
}

/**
 * Health ratio shown in the UI: equity as a fraction of notional. Kept on notional because
 * that is the existing API contract — but note it is NOT the liquidation trigger. Use
 * shouldLiquidate for that.
 */
export function computeMarginRatio(collateral: number, pnl: number, notional: number): number {
  return notional > 0 ? computeEquity(collateral, pnl) / notional : 0;
}

/** The liquidation trigger. Equivalent to the mark crossing calcLiqPrice. */
export function shouldLiquidate(collateral: number, pnl: number): boolean {
  return computeEquity(collateral, pnl) <= MAINTENANCE_MARGIN_RATIO * collateral;
}

/** PnL clamped to the 300% profit cap and to a total loss of collateral. */
export function clampPnl(pnl: number, collateral: number): number {
  return Math.max(-collateral, Math.min(pnl, collateral * PROFIT_CAP_ROE));
}

export type CloseReason = 'stop_loss' | 'take_profit' | 'profit_cap' | 'liquidation';

/**
 * Whether an SL/TP pair sits on the correct side of the mark. Returns an error message, or null
 * if the levels are usable.
 *
 * Wrong-side levels are self-harm, not an exploit: closePosition fills at the mark, never at the
 * requested level, so a take-profit set below market cannot mint value. What it does is
 * force-close the position on the next 15s risk tick and charge a close fee for a move the user
 * never asked for. Same for a stop-loss on the wrong side. Neither is ever intentional, so they
 * are rejected at the door rather than honoured.
 *
 * Levels exactly at the mark are rejected too — evaluatePosition triggers on `<=` / `>=`, so an
 * at-the-mark level fires on the very next tick.
 *
 * Note this only constrains the side, not the distance. A long stop below the liquidation price
 * is allowed: it is inert rather than wrong (liquidation is checked last and wins), and the mark
 * moves, so today's unreachable stop is tomorrow's live one.
 */
export function validateTriggerLevels(params: {
  direction: Direction;
  markPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
}): string | null {
  const { direction, markPrice, stopLoss, takeProfit } = params;
  const long = direction === 'long';
  const at = markPrice.toFixed(2);

  if (stopLoss !== null) {
    if (long && stopLoss >= markPrice) return `Stop-loss must be below the current price of ${at}`;
    if (!long && stopLoss <= markPrice) return `Stop-loss must be above the current price of ${at}`;
  }

  if (takeProfit !== null) {
    if (long && takeProfit <= markPrice) return `Take-profit must be above the current price of ${at}`;
    if (!long && takeProfit >= markPrice) return `Take-profit must be below the current price of ${at}`;
  }

  // No stop-vs-target cross-check is needed: the two rules above already force
  // stopLoss < mark < takeProfit for a long, and the reverse for a short.
  return null;
}

/** Whether a position should be force-closed at markPrice, and why. Order matters: liquidation wins. */
export function evaluatePosition(params: {
  entryPrice: number;
  markPrice: number;
  notional: number;
  collateral: number;
  direction: Direction;
  stopLoss: number | null;
  takeProfit: number | null;
}): { pnl: number; roe: number; reason: CloseReason | null } {
  const { entryPrice, markPrice, notional, collateral, direction, stopLoss, takeProfit } = params;
  const pnl = computePnl(entryPrice, markPrice, notional, direction);
  const roe = computeRoe(pnl, collateral);
  const long = direction === 'long';

  let reason: CloseReason | null = null;

  if (stopLoss !== null && (long ? markPrice <= stopLoss : markPrice >= stopLoss)) reason = 'stop_loss';
  else if (takeProfit !== null && (long ? markPrice >= takeProfit : markPrice <= takeProfit)) reason = 'take_profit';
  else if (roe >= PROFIT_CAP_ROE) reason = 'profit_cap';

  // Checked last so it overrides: a position that is both past its stop and underwater enough
  // to be insolvent is a liquidation, not a stop-loss.
  if (shouldLiquidate(collateral, pnl)) reason = 'liquidation';

  return { pnl, roe, reason };
}
