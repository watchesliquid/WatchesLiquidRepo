"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { MAX_LEVERAGE, MIN_POSITION_SIZE_USD, OPEN_FEE_RATE } from "shared/constants";
import { getMarketById } from "shared/markets";
import { calcLiqPrice } from "shared/margin";

const LEV_PRESETS = [2, 5, 10, 25, 50];

interface Props { market: any; }

export function TradePanel({ market }: Props) {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [size, setSize] = useState(100);
  const [leverage, setLeverage] = useState(5);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [error, setError] = useState("");

  const marketConfig = market ? getMarketById(market.marketId) : null;
  const maxLev = marketConfig?.maxLeverage ?? MAX_LEVERAGE;

  const { data: positionsData } = useQuery({
    queryKey: ["positions"], queryFn: () => api.getPositions(),
    enabled: !!user, refetchInterval: 5000,
  });

  const positions = positionsData?.positions ?? [];
  const activePosition = positions.find((p: any) => p.marketId === market?.marketId && p.status === "open");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["positions"] });
    queryClient.invalidateQueries({ queryKey: ["markets"] });
    refreshUser();
  };

  const openMutation = useMutation({
    mutationFn: () => api.openPosition({ marketId: market.marketId, direction, size, leverage, stopLoss: stopLoss ? Number(stopLoss) : undefined, takeProfit: takeProfit ? Number(takeProfit) : undefined }),
    onSuccess: () => { invalidate(); setError(""); },
    onError: (err: Error) => setError(err.message),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.closePosition(activePosition?.id),
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  if (!market) {
    return (
      <div className="panel">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⌚</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Select a watch<br />to start trading</div>
          </div>
        </div>
      </div>
    );
  }

  const price = market.indexPrice ?? 0;
  const notional = size * leverage;
  const fee = notional * OPEN_FEE_RATE;
  const requiredMargin = size + fee;
  // Shared with the keeper's risk engine — a local copy here would drift from the rule that
  // actually liquidates you.
  const liquidationPrice = calcLiqPrice(price, leverage, direction);
  const canOpen = user && user.balanceUsd >= requiredMargin && size >= MIN_POSITION_SIZE_USD;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-market-name" title={market.name}>{market.name}</div>
        <div className="panel-market-price">${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>

      <div className="panel-body">
        {/* ── Active Position (compact card) ── */}
        {activePosition && (() => {
          const pnl = activePosition.unrealizedPnl ?? 0;
          const pnlPct = activePosition.collateral ? (pnl / activePosition.collateral) * 100 : 0;
          return (
            <div className={`pnl-card ${pnl >= 0 ? 'up' : 'down'}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className={`pos-badge ${activePosition.direction}`}>
                    {activePosition.direction === 'long' ? '▲ LONG' : '▼ SHORT'} {activePosition.leverage}x
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`pnl-value ${pnl >= 0 ? 'text-green' : 'text-red'}`} style={{ fontSize: 20 }}>
                    {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                  </div>
                  <div className={`pnl-roe ${pnlPct >= 0 ? 'text-green' : 'text-red'}`} style={{ fontSize: 10 }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% ROE
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 8, fontSize: 10 }}>
                {[["Size", `$${Number(activePosition.collateral).toLocaleString()}`], ["Entry", `$${activePosition.entryPrice?.toFixed(2)}`], ["Liq", `$${activePosition.liquidationPrice?.toFixed(2)}`]].map(([l, v]) => (
                  <div key={l}><span style={{ color: 'var(--text-muted)' }}>{l}</span> <span className="mono">{v}</span></div>
                ))}
              </div>
              <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="btn btn-danger" style={{ width: '100%', marginTop: 8, padding: '6px 0', fontSize: 11 }}>
                {closeMutation.isPending ? 'Closing...' : 'Close Position'}
              </button>
            </div>
          );
        })()}

        {/* ── Order Entry (always visible) ── */}
        <div className="dir-toggle">
          <button className={`dir-btn up ${direction === 'long' ? 'active' : ''}`} onClick={() => setDirection("long")}>
            <span className="icon">▲</span> Long
          </button>
          <button className={`dir-btn down ${direction === 'short' ? 'active' : ''}`} onClick={() => setDirection("short")}>
            <span className="icon">▼</span> Short
          </button>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>Leverage</div>
          <div className="lev-presets">
            {LEV_PRESETS.filter(l => l <= maxLev).map(l => (
              <button key={l} className={`lev-preset ${leverage === l ? 'active' : ''}`} onClick={() => setLeverage(l)}>{l}x</button>
            ))}
          </div>
        </div>

        <div className="size-section">
          <div className="size-label">Size (USD)</div>
          <input type="number" className="size-input" value={size} onChange={(e) => setSize(Number(e.target.value))} min={MIN_POSITION_SIZE_USD} placeholder="100" />
        </div>

        <div className="sltp-row">
          <div>
            <div className="sltp-label">Stop Loss</div>
            <input type="text" className="sltp-input" placeholder={`$${(price * 0.9).toFixed(0)}`} value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
          </div>
          <div>
            <div className="sltp-label">Take Profit</div>
            <input type="text" className="sltp-input" placeholder={`$${(price * 1.1).toFixed(0)}`} value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
          </div>
        </div>

        <div className="summary">
          {([["Notional", `$${notional.toLocaleString()}`], [`Fee (${(OPEN_FEE_RATE * 100).toFixed(2)}%)`, `$${fee.toFixed(2)}`], ["Margin Required", `$${requiredMargin.toFixed(2)}`], ["Est. Liq Price", `$${liquidationPrice.toFixed(2)}`, true]] as [string, string, boolean?][]).map(([l, v, d]) => (
            <div key={l} className="summary-row"><span className="label">{l}</span><span className={`value ${d ? 'danger' : ''}`}>{v}</span></div>
          ))}
          {user && <><div className="summary-divider" /><div className="summary-row"><span className="label">Balance</span><span className={`value ${Number(user.balanceUsd) >= requiredMargin ? 'text-green' : 'text-red'}`}>${Number(user.balanceUsd).toLocaleString()}</span></div></>}
        </div>
      </div>

      <div className="panel-footer">
        {!user ? (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>Connect your wallet to start trading</div>
        ) : (
          <button onClick={() => openMutation.mutate()} disabled={!canOpen || openMutation.isPending} className={`trade-btn ${direction === 'long' ? 'up' : 'down'}`}>
            {openMutation.isPending ? 'Placing...' : `${direction === 'long' ? 'Open Long' : 'Open Short'}`}
          </button>
        )}
        {error && <div className="panel-error">{error}</div>}
      </div>
    </div>
  );
}
