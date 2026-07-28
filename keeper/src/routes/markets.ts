import { Router } from "express";
import { memDb } from "../db/memory";

export const marketsRouter = Router();

// GET /api/markets/stats — protocol-wide aggregates for the home page.
// MUST be declared before "/:id", or Express matches it as a market with id "stats".
// Implements the ProtocolStats type in shared/src/types.ts, which was declared but never built.
marketsRouter.get("/stats", (_req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = memDb.trades.filter((t: any) => new Date(t.created_at).getTime() >= cutoff);

  const volume24h = recent.reduce((s: number, t: any) => s + Number(t.size) * (t.leverage ?? 1), 0);
  const uniqueTraders = new Set(recent.map((t: any) => t.user_id)).size;
  const openPositions = memDb.positions.filter((p: any) => p.status === "open").length;
  const openInterest = memDb.markets.reduce(
    (s: number, m: any) => s + Number(m.open_interest_long) + Number(m.open_interest_short),
    0,
  );

  const active = memDb.markets.filter((m: any) => m.is_active !== false);
  const avgFundingRate = active.length
    ? active.reduce((s: number, m: any) => s + Number(m.funding_rate), 0) / active.length
    : 0;

  res.json({
    trades24h: recent.length,
    volume24h,
    uniqueTraders,
    openPositions,
    openInterest,
    avgFundingRate,
    marketsTracked: active.length,
  });
});

// GET /api/markets
marketsRouter.get("/", (_req, res) => {
  const all = memDb.markets.filter((m: any) => m.is_active !== false);

  const result = all.map((m: any) => ({
    marketId: m.id,
    name: m.name,
    category: m.category,
    referenceNumber: m.reference_number,
    brand: m.brand,
    ticker: m.ticker,
    imageUrl: m.image_url,
    indexPrice: Number(m.index_price),
    markPrice: Number(m.mark_price),
    openInterestLong: Number(m.open_interest_long),
    openInterestShort: Number(m.open_interest_short),
    fundingRate: Number(m.funding_rate),
    maxLeverage: m.max_leverage,
    minPositionSize: Number(m.min_position_size),
    feeRate: Number(m.fee_rate),
    change24h: m._change24h ?? 0,
    volume24h: m._volume24h ?? 0,
    high24h: m._high24h ?? Number(m.index_price),
    low24h: m._low24h ?? Number(m.index_price),
    oracleUpdatedAt: Date.now(),
    oracleConfidence: 0.98,
    isActive: m.is_active !== false,
  }));

  res.json({ markets: result });
});

// GET /api/markets/:id
marketsRouter.get("/:id", (req, res) => {
  const m = memDb.markets.find((mk: any) => mk.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Market not found" });

  res.json({
    marketId: m.id,
    name: m.name,
    category: m.category,
    indexPrice: Number(m.index_price),
    markPrice: Number(m.mark_price),
    openInterestLong: Number(m.open_interest_long),
    openInterestShort: Number(m.open_interest_short),
    fundingRate: Number(m.funding_rate),
    maxLeverage: m.max_leverage,
    minPositionSize: Number(m.min_position_size),
    feeRate: Number(m.fee_rate),
  });
});

// GET /api/markets/:id/candles
marketsRouter.get("/:id/candles", (req, res) => {
  const resolution = (req.query.resolution as string) ?? "1h";
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

  const candles = memDb.candles
    .filter((c: any) => c.market_id === req.params.id && c.resolution === resolution)
    .sort((a: any, b: any) => new Date(b.open_time).getTime() - new Date(a.open_time).getTime())
    .slice(0, limit)
    .reverse()
    .map((c: any) => ({
      time: Math.floor(new Date(c.open_time).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));

  res.json({ candles });
});

// GET /api/markets/:id/trades/recent
marketsRouter.get("/:id/trades/recent", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const recent = memDb.trades
    .filter((t: any) => t.market_id === req.params.id)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((t: any) => ({
      id: t.id,
      marketId: t.market_id,
      type: t.type,
      direction: t.direction,
      size: Number(t.size),
      price: Number(t.price),
      createdAt: t.created_at,
    }));

  res.json({ trades: recent });
});
