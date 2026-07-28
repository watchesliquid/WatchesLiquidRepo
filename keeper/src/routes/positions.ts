import { Router } from "express";
import { memDb } from "../db/memory";
import { isMarketPaused } from "../services/audit";
import { authMiddleware } from "./auth";
import { calcLiqPrice, computePnl, computeRoe, computeMarginRatio, clampPnl } from "shared/margin";
import type { Direction } from "shared/types";

export const positionsRouter = Router();
positionsRouter.use(authMiddleware);

// GET /api/positions
positionsRouter.get("/", (req: any, res) => {
  const openPositions = memDb.positions.filter(
    (p: any) => p.user_id === req.userId && p.status === "open",
  );

  const result = openPositions.map((p: any) => {
    const market = memDb.markets.find((m: any) => m.id === p.market_id);
    const markPrice = market ? Number(market.index_price) : Number(p.entry_price);
    const entryPrice = Number(p.entry_price);
    const notional = Number(p.notional);

    const unrealizedPnl = computePnl(entryPrice, markPrice, notional, p.direction as Direction);
    const roe = computeRoe(unrealizedPnl, Number(p.collateral));
    const marginRatio = computeMarginRatio(Number(p.collateral), unrealizedPnl, notional);

    return {
      id: p.id,
      userId: p.user_id,
      marketId: p.market_id,
      direction: p.direction,
      collateral: Number(p.collateral),
      size: Number(p.size),
      leverage: p.leverage,
      notional: Number(p.notional),
      entryPrice,
      liquidationPrice: Number(p.liquidation_price),
      markPrice,
      stopLoss: p.stop_loss ? Number(p.stop_loss) : null,
      takeProfit: p.take_profit ? Number(p.take_profit) : null,
      status: p.status,
      openedAt: p.opened_at,
      unrealizedPnl,
      roe,
      marginRatio,
    };
  });

  res.json({ positions: result });
});

// POST /api/positions/open
positionsRouter.post("/open", (req: any, res) => {
  try {
    const { marketId, direction, size, leverage, stopLoss, takeProfit } = req.body;
    if (!marketId || !direction || !size || !leverage) {
      return res.status(400).json({ error: "marketId, direction, size, leverage required" });
    }
    if (direction !== "long" && direction !== "short") {
      return res.status(400).json({ error: "direction must be 'long' or 'short'" });
    }

    const market = memDb.markets.find((m: any) => m.id === marketId);
    if (!market) return res.status(400).json({ error: "Market not found" });
    if (!market.is_active) return res.status(400).json({ error: "Market not active" });
    // Admin halt. Deliberately only blocks OPENING — a paused market must still allow closing,
    // otherwise pausing would trap users in positions they cannot exit while the price moves.
    if (isMarketPaused(marketId)) return res.status(503).json({ error: "This market is temporarily halted" });

    const s = Number(size);
    const lev = Number(leverage);
    if (!isFinite(s) || s < 1) return res.status(400).json({ error: "Min size: $1" });
    if (!isFinite(lev) || lev < 1) return res.status(400).json({ error: "Min leverage: 1x" });
    if (lev > market.max_leverage) return res.status(400).json({ error: `Max leverage: ${market.max_leverage}x` });

    // Max 5 positions total
    const openCount = memDb.positions.filter(
      (p: any) => p.user_id === req.userId && p.status === "open",
    ).length;
    if (openCount >= 5) return res.status(400).json({ error: "Max 5 open positions" });

    const user = memDb.users.find((u: any) => u.id === req.userId);
    if (!user) return res.status(400).json({ error: "User not found" });

    const entryPrice = Number(market.index_price);
    const notional = s * lev;
    const feeRate = Number(market.fee_rate);
    const fee = notional * feeRate;
    const requiredMargin = s + fee;
    if (Number(user.balance_usd) < requiredMargin) {
      return res.status(400).json({
        error: `Insufficient balance. Need $${requiredMargin.toFixed(2)}, have $${Number(user.balance_usd).toFixed(2)}`,
      });
    }

    const liqPrice = calcLiqPrice(entryPrice, lev, direction as Direction);

    // Deduct balance
    user.balance_usd = String(Number(user.balance_usd) - requiredMargin);

    // Create position
    const posId = crypto.randomUUID();
    const position = {
      id: posId,
      user_id: req.userId,
      market_id: marketId,
      direction,
      collateral: String(s),
      size: String(s),
      leverage: lev,
      notional: String(notional),
      entry_price: String(entryPrice),
      liquidation_price: String(liqPrice),
      stop_loss: stopLoss ? String(stopLoss) : null,
      take_profit: takeProfit ? String(takeProfit) : null,
      status: "open",
      opened_at: new Date().toISOString(),
      closed_at: null,
      close_price: null,
      pnl: "0",
    };
    memDb.positions.push(position);

    // Record trade
    const tradeId = crypto.randomUUID();
    memDb.trades.push({
      id: tradeId,
      user_id: req.userId,
      market_id: marketId,
      position_id: posId,
      type: "open",
      direction,
      size: String(s),
      leverage: lev,
      price: String(entryPrice),
      fee: String(fee),
      pnl: "0",
      created_at: new Date().toISOString(),
    });

    // Update OI
    const oiField = direction === "long" ? "open_interest_long" : "open_interest_short";
    market[oiField] = String(Number(market[oiField]) + notional);

    res.json({
      position: { ...position, unrealizedPnl: 0, roe: 0, marginRatio: 1, markPrice: entryPrice },
      trade: { id: tradeId, type: "open", direction, size: s, fee, price: entryPrice },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/positions/:id/close
positionsRouter.post("/:id/close", (req: any, res) => {
  try {
    const pos = memDb.positions.find((p: any) => p.id === req.params.id && p.user_id === req.userId);
    if (!pos) return res.status(404).json({ error: "Position not found" });
    if (pos.status !== "open") return res.status(400).json({ error: "Position already closed" });

    const market = memDb.markets.find((m: any) => m.id === pos.market_id);
    if (!market) return res.status(400).json({ error: "Market not found" });

    const exitPrice = Number(market.index_price);
    const entryPrice = Number(pos.entry_price);
    const notional = Number(pos.notional);
    const collateral = Number(pos.collateral);
    const feeRate = Number(market.fee_rate);
    const direction = pos.direction;

    // Profit cap (300% ROE) and total-loss floor both live in clampPnl.
    const pnl = clampPnl(computePnl(entryPrice, exitPrice, notional, direction as Direction), collateral);

    const closeFee = notional * feeRate;
    const credit = Math.max(0, collateral + pnl - closeFee);

    // Credit user
    const user = memDb.users.find((u: any) => u.id === req.userId);
    if (user) {
      user.balance_usd = String(Number(user.balance_usd) + credit);
    }

    // Update position
    pos.status = "closed";
    pos.closed_at = new Date().toISOString();
    pos.close_price = String(exitPrice);
    pos.pnl = String(pnl);

    // Record trade
    const tradeId = crypto.randomUUID();
    memDb.trades.push({
      id: tradeId,
      user_id: req.userId,
      market_id: pos.market_id,
      position_id: pos.id,
      type: "close",
      direction,
      size: String(collateral),
      leverage: pos.leverage,
      price: String(exitPrice),
      fee: String(closeFee),
      pnl: String(pnl),
      created_at: new Date().toISOString(),
    });

    // Update OI
    const oiField = direction === "long" ? "open_interest_long" : "open_interest_short";
    market[oiField] = String(Math.max(0, Number(market[oiField]) - notional));

    res.json({
      position: { ...pos, markPrice: exitPrice, unrealizedPnl: 0, roe: 0, marginRatio: 1 },
      trade: { id: tradeId, type: "close", direction, pnl, fee: closeFee },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/positions/:id/sl-tp
positionsRouter.post("/:id/sl-tp", (req: any, res) => {
  try {
    const pos = memDb.positions.find((p: any) => p.id === req.params.id && p.user_id === req.userId);
    if (!pos) return res.status(404).json({ error: "Position not found" });
    if (pos.status !== "open") return res.status(400).json({ error: "Position already closed" });
    const { stopLoss, takeProfit } = req.body;
    if (stopLoss !== undefined) pos.stop_loss = stopLoss ? String(stopLoss) : null;
    if (takeProfit !== undefined) pos.take_profit = takeProfit ? String(takeProfit) : null;
    res.json({ ...pos, stopLoss: pos.stop_loss ? Number(pos.stop_loss) : null, takeProfit: pos.take_profit ? Number(pos.take_profit) : null });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
