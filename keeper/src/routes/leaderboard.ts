import { Router } from "express";
import { memDb } from "../db/memory";

export const leaderboardRouter = Router();

// GET /api/leaderboard?period=7d&limit=50
leaderboardRouter.get("/", (req, res) => {
  const period = (req.query.period as string) ?? "7d";
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const now = Date.now();
  const periodMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    all: 0,
  };
  const cutoff = periodMs[period] ? now - periodMs[period] : 0;

  // Aggregate by user
  const userPnL: Record<string, { pnl: number; trades: number; wins: number }> = {};

  for (const t of memDb.trades) {
    const tTime = new Date(t.created_at).getTime();
    if (cutoff > 0 && tTime < cutoff) continue;

    if (!userPnL[t.user_id]) {
      userPnL[t.user_id] = { pnl: 0, trades: 0, wins: 0 };
    }
    userPnL[t.user_id].pnl += Number(t.pnl);
    userPnL[t.user_id].trades++;
    if (Number(t.pnl) > 0) userPnL[t.user_id].wins++;
  }

  const entries = Object.entries(userPnL)
    .sort(([, a], [, b]) => b.pnl - a.pnl)
    .slice(0, limit)
    .map(([userId, data], i) => {
      const user = memDb.users.find((u: any) => u.id === userId);
      const roi = user ? (data.pnl / Math.max(1, Number(user.balance_usd))) * 100 : 0;
      const winRate = data.trades > 0 ? data.wins / data.trades : 0;

      return {
        rank: i + 1,
        userId,
        pnl: data.pnl,
        roi,
        winRate,
        tradeCount: data.trades,
        topMarket: "-",
      };
    });

  res.json({ entries });
});
