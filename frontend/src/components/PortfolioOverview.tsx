"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Icon } from "./Icons";
import { FUNDING_INTERVAL_MS } from "shared/constants";

/** Cumulative realised P&L from real closed trades. No line until there's something to draw. */
function PnlChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div className="pf-chart" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 11 }}>
        No closed trades yet
      </div>
    );
  }
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * 300;
    const y = 56 - ((v - min) / range) * 52 - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = points[points.length - 1] >= 0;
  const stroke = up ? "var(--accent)" : "var(--red)";

  return (
    <svg className="pf-chart" viewBox="0 0 300 58" preserveAspectRatio="none">
      <polygon
        points={`0,58 ${coords.join(" ")} 300,58`}
        fill={up ? "rgba(225,255,0,0.06)" : "rgba(255,62,62,0.06)"}
      />
      <polyline
        points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth={1.8}
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** ms until the next 8h funding boundary. Matches the keeper's interval; the exact settlement
 *  is driven server-side, so this is indicative rather than authoritative. */
function nextFundingIn(): string {
  const ms = FUNDING_INTERVAL_MS - (Date.now() % FUNDING_INTERVAL_MS);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function PortfolioOverview({ avgFunding }: { avgFunding: number }) {
  const { user, loginWithWallet, walletInstalled } = useAuth();
  const [hidden, setHidden] = useState(false);
  // Seeded empty and filled on mount: nextFundingIn() reads Date.now(), so rendering it during
  // SSR guarantees a hydration mismatch against the client's clock.
  const [countdown, setCountdown] = useState("--:--:--");

  useEffect(() => {
    setCountdown(nextFundingIn());
    const t = setInterval(() => setCountdown(nextFundingIn()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: tradesData } = useQuery({
    queryKey: ["trades"],
    queryFn: () => api.getTradeHistory(50),
    enabled: !!user,
    refetchInterval: 10_000,
  });
  const { data: posData } = useQuery({
    queryKey: ["positions"],
    queryFn: () => api.getPositions(),
    enabled: !!user,
    refetchInterval: 5_000,
  });

  const trades = tradesData?.trades ?? [];
  const positions = posData?.positions ?? [];

  // Realised P&L, oldest first.
  const closed = [...trades].filter((t: any) => t.type !== "open").reverse();
  let cum = 0;
  const series = closed.map((t: any) => (cum += Number(t.pnl ?? 0)));
  const realised = cum;
  const unrealised = positions.reduce((s: number, p: any) => s + (p.unrealizedPnl ?? 0), 0);
  const balance = Number(user?.balanceUsd ?? 0);

  // Funding is protocol state, not user state — it belongs on the page whether or not anyone is
  // connected. Hiding it behind the login was my bug, not the design's.
  const fundingBox = (
    <div className="funding-box">
      <div>
        <h5>Funding / Countdown</h5>
        <span className={avgFunding >= 0 ? "text-green" : "text-red"} style={{ fontWeight: 600 }}>
          {(avgFunding * 100).toFixed(4)}%
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 10.5, marginLeft: 6 }}>
          {avgFunding === 0 ? "Neutral" : avgFunding > 0 ? "Longs Pay Shorts" : "Shorts Pay Longs"}
        </span>
      </div>
      <div className="funding-timer">{countdown}</div>
    </div>
  );

  if (!user) {
    return (
      <div className="pf-card">
        <div className="pf-head"><span>Portfolio Overview</span></div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
          Connect a wallet to see your balance, P&amp;L and open positions.
        </div>
        <button onClick={loginWithWallet} className="btn btn-primary" style={{ width: "100%", padding: 11 }}>
          {walletInstalled ? "Connect Wallet" : "Install a Wallet"}
        </button>
        {fundingBox}
      </div>
    );
  }

  return (
    <div className="pf-card">
      <div className="pf-head">
        <span>Portfolio Overview</span>
        <button onClick={() => setHidden((h) => !h)} className="icon-btn" style={{ width: 22, height: 22 }} aria-label={hidden ? "Show balances" : "Hide balances"}>
          <Icon name="eye" size={14} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="pf-label">Total Balance</span>
        <span className="pf-amount">{hidden ? "••••••" : `$${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</span>
        {!hidden && (
          <span style={{ fontSize: 11, fontWeight: 600 }} className={unrealised >= 0 ? "text-green" : "text-red"}>
            {unrealised >= 0 ? "+" : ""}${unrealised.toFixed(2)} unrealised
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {" · "}{realised >= 0 ? "+" : ""}${realised.toFixed(2)} realised
            </span>
          </span>
        )}
      </div>

      <PnlChart points={series} />

      <div className="pf-actions">
        <Link href="/profile" className="btn btn-primary" style={{ textAlign: "center", padding: 9 }}>Deposit</Link>
        <Link href="/profile" className="btn btn-ghost" style={{ textAlign: "center", padding: 9 }}>Withdraw</Link>
      </div>

      {fundingBox}
    </div>
  );
}
