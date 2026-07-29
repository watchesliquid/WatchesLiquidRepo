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

  // Aggregate by user. `staked` is collateral deployed on closing trades, which is what ROI is
  // measured against below.
  const userPnL: Record<string, { pnl: number; trades: number; wins: number; staked: number }> = {};

  for (const t of memDb.trades) {
    const tTime = new Date(t.created_at).getTime();
    if (cutoff > 0 && tTime < cutoff) continue;

    if (!userPnL[t.user_id]) {
      userPnL[t.user_id] = { pnl: 0, trades: 0, wins: 0, staked: 0 };
    }
    userPnL[t.user_id].pnl += Number(t.pnl);
    userPnL[t.user_id].trades++;
    if (Number(t.pnl) > 0) userPnL[t.user_id].wins++;
    // Close/liquidate rows carry the position's collateral in `size`; open rows are the entry
    // leg of the same position and would double-count it.
    if (t.type !== "open") userPnL[t.user_id].staked += Number(t.size) || 0;
  }

  const entries = Object.entries(userPnL)
    .sort(([, a], [, b]) => b.pnl - a.pnl)
    .slice(0, limit)
    .map(([userId, data], i) => {
      // ROI is return on capital DEPLOYED, not on the account's current balance.
      //
      // It used to be pnl / balance_usd. Publishing both pnl and that ratio on an
      // unauthenticated endpoint published the balance itself: balance = pnl * 100 / roi, exactly
      // solvable for every account on the board. Return on deployed collateral is both the more
      // meaningful number for a trading leaderboard and free of that inversion.
      const roi = data.staked > 0 ? (data.pnl / data.staked) * 100 : 0;
      const winRate = data.trades > 0 ? data.wins / data.trades : 0;

      return {
        rank: i + 1,
        // A stable pseudonym, not the internal id. The raw userId was the join key for anything
        // else that leaks per-user data later; there is no reason a public board needs it.
        trader: `${userId.slice(0, 8)}`,
        pnl: data.pnl,
        roi,
        winRate,
        tradeCount: data.trades,
        topMarket: "-",
      };
    });

  res.json({ entries });
});
