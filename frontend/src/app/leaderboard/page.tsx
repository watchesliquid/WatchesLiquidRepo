"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { POLL_LEADERBOARD_MS } from "shared/constants";

const PERIODS = ["24h", "7d", "30d", "all"] as const;

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<string>("7d");
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", period],
    queryFn: () => api.getLeaderboard(period, 50),
    refetchInterval: POLL_LEADERBOARD_MS,
  });
  const entries = data?.entries ?? [];

  return (
    <div className="lb-page">
      <h1 className="lb-title">Leaderboard</h1>
      <p className="lb-subtitle">Top watch traders by P&L</p>

      <div className="lb-tabs">
        {PERIODS.map((p) => (
          <button key={p} className={`lb-tab ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 44, borderRadius: 0 }} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="market-card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏆</div>
          <div className="text-muted" style={{ fontSize: 13 }}>No activity yet</div>
        </div>
      ) : (
        <div className="lb-list">
          {entries.map((entry: any) => (
            <div key={entry.rank} className="lb-row">
              <div className="lb-rank">
                {entry.rank <= 3 ? ["🥇","🥈","🥉"][entry.rank-1] : `#${entry.rank}`}
              </div>
              {/* `trader` is a pseudonym from the API; the raw userId is no longer published. */}
              <div className="lb-user">{entry.trader}</div>
              <div className={`lb-pnl ${entry.pnl >= 0 ? 'text-green' : 'text-red'}`}>
                {entry.pnl >= 0 ? '+' : ''}${entry.pnl?.toFixed(2)}
              </div>
              <div className={`lb-roi ${entry.roi >= 0 ? 'text-green' : 'text-red'}`}>
                {entry.roi >= 0 ? '+' : ''}{entry.roi?.toFixed(1)}%
              </div>
              <div className="lb-trades">{entry.tradeCount} trades</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
