"use client";

import { useRef, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { SharePnlCard, type SharePosition } from "@/components/SharePnlCard";

export default function PortfolioPage() {
  const { user } = useAuth();
  const [sharing, setSharing] = useState<SharePosition | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: positionsData } = useQuery({
    queryKey: ["positions"], queryFn: () => api.getPositions(),
    enabled: !!user, refetchInterval: 5000,
  });
  const { data: tradesData } = useQuery({
    queryKey: ["trades"], queryFn: () => api.getTradeHistory(50),
    enabled: !!user,
  });
  const closePos = useMutation({
    mutationFn: (id: string) => api.closePosition(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["positions"] }); queryClient.invalidateQueries({ queryKey: ["me"] }); },
  });

  const positions = positionsData?.positions ?? [];
  const trades = tradesData?.trades ?? [];
  const totalPnl = positions.reduce((s: number, p: any) => s + (p.unrealizedPnl ?? 0), 0);
  const usedMargin = positions.reduce((s: number, p: any) => s + (p.collateral ?? 0), 0);

  // PnL canvas — hooks must be before any early return
  const pnlCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = pnlCanvasRef.current;
    if (!canvas || trades.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width, H = rect.height, pad = { top: 16, right: 8, bottom: 16, left: 48 };
    const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom;

    const sortedTrades = [...trades].reverse();
    const pnlPoints: number[] = [];
    let cum = 0;
    for (const t of sortedTrades) { cum += Number(t.pnl ?? 0); pnlPoints.push(cum); }

    const min = Math.min(0, ...pnlPoints) * 1.1;
    const max = Math.max(0, ...pnlPoints) * 1.1;
    const range = (max - min) || 1;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = pad.top + (ph / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }

    const zeroY = pad.top + ph - ((0 - min) / range) * ph;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(W - pad.right, zeroY); ctx.stroke();

    const linePath = new Path2D();
    const fillPath = new Path2D();
    pnlPoints.forEach((v, i) => {
      const x = pad.left + (pw / (pnlPoints.length - 1)) * i;
      const y = pad.top + ph - ((v - min) / range) * ph;
      if (i === 0) { linePath.moveTo(x, y); fillPath.moveTo(x, zeroY); fillPath.lineTo(x, y); }
      else { linePath.lineTo(x, y); fillPath.lineTo(x, y); }
    });
    fillPath.lineTo(pad.left + pw, zeroY); fillPath.closePath();

    const isUp = pnlPoints[pnlPoints.length - 1] >= 0;
    const gradient = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gradient.addColorStop(0, isUp ? "rgba(163,230,53,0.12)" : "rgba(248,113,113,0.12)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient; ctx.fill(fillPath);
    ctx.strokeStyle = isUp ? "#a3e635" : "#f87171";
    ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke(linePath);

    ctx.fillStyle = "var(--text-muted)"; ctx.font = "10px var(--mono)"; ctx.textAlign = "right";
    ctx.fillText(`$${max.toFixed(0)}`, pad.left - 4, pad.top + 10);
    ctx.fillText(`$${min.toFixed(0)}`, pad.left - 4, H - pad.bottom);
  }, [trades]);

  // Early return AFTER all hooks
  if (!user) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⌚</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Connect to view</div>
          <div className="text-muted" style={{ fontSize: 13 }}>Your positions and history will appear here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Portfolio</h1>
          <p className="page-subtitle">Your positions and trading activity</p>
        </div>
        {/* Was three "+$1K / +$10K / +$100K" buttons calling an undefined `deposit` — a
            ReferenceError on click, and free-money UI that must not exist next to real funds.
            Balance now comes only from an on-chain USDG deposit, which lives on /profile. */}
        <button onClick={() => router.push("/profile")} className="btn btn-ghost" style={{ fontSize: 11 }}>
          Deposit
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          ["Balance", `$${Number(user.balanceUsd).toLocaleString()}`],
          ["Total P&L", `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, totalPnl >= 0 ? 'text-green' : 'text-red'],
          ["Used Margin", `$${usedMargin.toLocaleString()}`],
          ["Available", `$${(Number(user.balanceUsd) - usedMargin).toLocaleString()}`],
        ].map(([label, value, cls]) => (
          <div key={label} className="stat-card">
            <div className="stat-card-label">{label}</div>
            <div className={`stat-card-value ${cls || ''}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* PnL Chart */}
      <div className="stat-card" style={{ marginBottom: 20, padding: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Cumulative P&amp;L
        </div>
        <canvas ref={pnlCanvasRef} style={{ width: '100%', height: 180 }} />
      </div>

      <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 10 }}>
        Open Positions
      </h2>

      {positions.length === 0 ? (
        <div className="stat-card" style={{ textAlign: 'center', padding: 32, marginBottom: 20 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📭</div>
          <div className="text-muted" style={{ fontSize: 13 }}>No open positions</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {positions.map((p: any) => {
            const pnl = p.unrealizedPnl ?? 0;
            const roe = p.collateral ? (pnl / p.collateral) * 100 : 0;
            return (
              // A DIV, not a button — and it must stay one.
              //
              // This row contains Share and Close buttons, and HTML forbids interactive content
              // inside a <button>. When it was one, the page's prerendered HTML contained nested
              // buttons; the browser's parser is required to close the outer one early, so the
              // action buttons were reparented into siblings and the DOM no longer matched what
              // React expected. Hydration then bound handlers to the wrong nodes, and clicking
              // Close on one position ran a different row's navigate — which is why it opened
              // the trade page for an unrelated watch instead of closing anything.
              //
              // stopPropagation on the inner buttons could never have fixed that: the handler
              // that fired was not the one attached to the element being clicked.
              <div
                key={p.id}
                onClick={() => router.push(`/trade?market=${p.marketId}`)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return; // let the real buttons handle their own keys
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/trade?market=${p.marketId}`); }
                }}
                role="button"
                tabIndex={0}
                className="mkt-card"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`pos-badge ${p.direction}`}>{p.direction.toUpperCase()} {p.leverage}x</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.marketId?.replace(/-/g, ' ').toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                      Entry ${p.entryPrice?.toFixed(2)} → Mark ${p.markPrice?.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div className={`mono ${pnl >= 0 ? 'text-green' : 'text-red'}`} style={{ fontSize: 14, fontWeight: 700 }}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className={`${roe >= 0 ? 'text-green' : 'text-red'}`} style={{ fontSize: 10, fontWeight: 600 }}>
                      {roe >= 0 ? '+' : ''}{roe.toFixed(2)}%
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSharing({
                        marketId: p.marketId,
                        direction: p.direction,
                        leverage: p.leverage,
                        entryPrice: p.entryPrice,
                        exitPrice: p.markPrice,
                        collateral: p.collateral,
                        pnl,
                        settled: false,
                      });
                    }}
                    className="btn" style={{ padding: '5px 10px', fontSize: 10 }}
                  >
                    Share
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); closePos.mutate(p.id); }}
                    disabled={closePos.isPending}
                    className="btn btn-danger" style={{ padding: '5px 10px', fontSize: 10 }}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 10 }}>
        Trade History
      </h2>

      {trades.length === 0 ? (
        <div className="stat-card" style={{ textAlign: 'center', padding: 24 }}>
          <div className="text-muted" style={{ fontSize: 13 }}>No trades yet</div>
        </div>
      ) : (
        <div className="stat-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <td style={{ padding: '8px 12px' }}>Type</td>
                  <td style={{ padding: '8px 12px' }}>Market</td>
                  <td style={{ padding: '8px 12px' }}>Direction</td>
                  <td style={{ padding: '8px 12px' }}>Size</td>
                  <td style={{ padding: '8px 12px' }}>Price</td>
                  <td style={{ padding: '8px 12px' }}>Fee</td>
                  <td style={{ padding: '8px 12px' }}>P&amp;L</td>
                </tr>
              </thead>
              <tbody style={{ fontSize: 11 }}>
                {trades.slice(0, 30).map((t: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <span className={`pos-badge ${t.type === 'open' ? 'long' : t.type === 'liquidate' ? 'short' : ''}`} style={t.type === 'close' ? { background: 'var(--hover)', color: 'var(--text-secondary)' } : {}}>
                        {t.type?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>{t.marketId}</td>
                    <td className={`mono ${t.direction === 'long' ? 'text-green' : 'text-red'}`} style={{ padding: '8px 12px' }}>{t.direction}</td>
                    <td className="mono" style={{ padding: '8px 12px' }}>${t.size?.toLocaleString()}</td>
                    <td className="mono" style={{ padding: '8px 12px' }}>${t.price?.toFixed(2)}</td>
                    <td className="mono" style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>${t.fee?.toFixed(2)}</td>
                    <td className={`mono ${(t.pnl ?? 0) >= 0 ? 'text-green' : 'text-red'}`} style={{ padding: '8px 12px', fontWeight: 700 }}>
                      {(t.pnl ?? 0) >= 0 ? '+' : ''}${t.pnl?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sharing && (
        <SharePnlCard
          position={sharing}
          displayName={user?.displayName ?? user?.username ?? String(user?.id ?? "").slice(0, 8)}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
