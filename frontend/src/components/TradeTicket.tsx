"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { MAX_LEVERAGE, MIN_POSITION_SIZE_USD, OPEN_FEE_RATE } from "shared/constants";
import { getMarketById } from "shared/markets";
import { calcLiqPrice } from "shared/margin";

interface Props { market: any; }

export function TradeTicket({ market }: Props) {
  const { user } = useAuth();
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
    queryKey: ["positions"],
    queryFn: () => api.getPositions(),
    enabled: !!user, refetchInterval: 5000,
  });

  const positions = positionsData?.positions ?? [];
  const activePosition = positions.find(
    (p: any) => p.marketId === market?.marketId && p.status === "open",
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["positions"] });
    queryClient.invalidateQueries({ queryKey: ["markets"] });
    queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const openMutation = useMutation({
    mutationFn: () => api.openPosition({
      marketId: market.marketId, direction, size, leverage,
      stopLoss: stopLoss ? Number(stopLoss) : undefined,
      takeProfit: takeProfit ? Number(takeProfit) : undefined,
    }),
    onSuccess: () => { invalidate(); setError(""); },
    onError: (err: Error) => setError(err.message),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.closePosition(activePosition?.id),
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const slTpMutation = useMutation({
    mutationFn: () => api.updateSlTp(
      activePosition?.id,
      stopLoss ? Number(stopLoss) : null,
      takeProfit ? Number(takeProfit) : null,
    ),
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  if (!market) {
    return (
      <div className="panel">
        <div className="panel-empty">
          <div>
            <div className="panel-empty-icon">⌚</div>
            <div className="panel-empty-text">Select a watch<br />to start trading</div>
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

  // ── Position View ──
  if (activePosition) {
    const pnl = activePosition.unrealizedPnl ?? 0;
    const pnlPct = activePosition.collateral ? (pnl / activePosition.collateral) * 100 : 0;

    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Your Position</div>
          <div style={{ marginTop: 4 }}>
            <span className={`pos-badge ${activePosition.direction}`}>
              {activePosition.direction.toUpperCase()} {activePosition.leverage}x
            </span>
          </div>
          <div className="panel-subtitle" style={{ marginTop: 4 }}>{market.name}</div>
        </div>

        <div className={`pos-pnl-card ${pnl >= 0 ? 'up' : 'down'}`}>
          <div className="pos-pnl-label">Unrealized P&amp;L</div>
          <div className={`pos-pnl-value ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          </div>
          <div className={`pos-pnl-roe ${pnlPct >= 0 ? 'text-green' : 'text-red'}`}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% ROE
          </div>
        </div>

        <div className="pos-detail">
          {([
            ["Entry", `$${activePosition.entryPrice?.toFixed(2)}`],
            ["Mark", `$${activePosition.markPrice?.toFixed(2)}`],
            ["Collateral", `$${Number(activePosition.collateral).toLocaleString()}`],
            ["Notional", `$${Number(activePosition.notional).toLocaleString()}`],
            ["Liquidation", `$${activePosition.liquidationPrice?.toFixed(2)}`, true],
          ] as [string, string, boolean?][]).map(([label, value, danger]) => (
            <div key={label} className="pos-detail-row">
              <span className="label">{label}</span>
              <span className={`value ${danger ? 'text-red' : ''}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* No "Add Margin" control: margin is isolated per position and there is no endpoint to
            top one up. It used to call api.deposit(-amount) — a method that does not exist —
            behind a .catch(() => {}), so the button silently did nothing on every click. */}

        {/* SL/TP */}
        <div style={{ padding: '0 16px', marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>STOP LOSS</div>
              <input
                type="text" className="size-input" style={{ fontSize: 11 }}
                placeholder={activePosition.stopLoss ? `$${activePosition.stopLoss}` : "None"}
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>TAKE PROFIT</div>
              <input
                type="text" className="size-input" style={{ fontSize: 11 }}
                placeholder={activePosition.takeProfit ? `$${activePosition.takeProfit}` : "None"}
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
              />
            </div>
          </div>
          {(stopLoss || takeProfit) && (
            <button
              className="btn btn-ghost" style={{ marginTop: 6, fontSize: 10, width: '100%' }}
              onClick={() => slTpMutation.mutate()}
              disabled={slTpMutation.isPending}
            >
              {slTpMutation.isPending ? 'Updating...' : 'Update SL/TP'}
            </button>
          )}
        </div>

        <div style={{ padding: '0 16px', marginTop: 16 }}>
          <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="btn-danger">
            {closeMutation.isPending ? 'Closing...' : 'Close Position'}
          </button>
        </div>
        {error && <div className="panel-error">{error}</div>}
      </div>
    );
  }

  // ── Order Entry ──
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-subtitle">{market.name}</div>
        <div className="panel-price">${price.toFixed(2)}</div>
      </div>

      <div className="panel-body">
        <div className="dir-toggle">
          <button className={`dir-btn long ${direction === 'long' ? 'active' : ''}`} onClick={() => setDirection("long")}>▲ Long</button>
          <button className={`dir-btn short ${direction === 'short' ? 'active' : ''}`} onClick={() => setDirection("short")}>▼ Short</button>
        </div>

        <div>
          <div className="lev-row"><span className="lev-label">Leverage</span><span className="lev-value">{leverage}x</span></div>
          <div className="lev-range"><input type="range" min={1} max={maxLev} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} /></div>
          <div className="lev-limits"><span>1x</span><span>{maxLev}x</span></div>
        </div>

        <div>
          <div className="size-label">Size (USD)</div>
          <input type="number" className="size-input" value={size} onChange={(e) => setSize(Number(e.target.value))} min={MIN_POSITION_SIZE_USD} placeholder="$100" />
        </div>

        {/* SL/TP inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600 }}>STOP LOSS</div>
            <input type="text" className="size-input" style={{ fontSize: 11 }} placeholder={`$${(price * 0.9).toFixed(0)}`} value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600 }}>TAKE PROFIT</div>
            <input type="text" className="size-input" style={{ fontSize: 11 }} placeholder={`$${(price * 1.1).toFixed(0)}`} value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
          </div>
        </div>

        <div className="summary">
          {([
            ["Notional", `$${notional.toLocaleString()}`],
            [`Fee (${(OPEN_FEE_RATE * 100).toFixed(2)}%)`, `$${fee.toFixed(2)}`],
            ["Margin Required", `$${requiredMargin.toFixed(2)}`],
            ["Est. Liq Price", `$${liquidationPrice.toFixed(2)}`, true],
          ] as [string, string, boolean?][]).map(([label, value, danger]) => (
            <div key={label} className="summary-row">
              <span className="label">{label}</span>
              <span className={`value ${danger ? 'danger' : ''}`}>{value}</span>
            </div>
          ))}
          {user && (
            <>
              <div className="summary-divider" />
              <div className="summary-row">
                <span className="label">Balance</span>
                <span className={`value ${Number(user.balanceUsd) >= requiredMargin ? 'text-green' : 'text-red'}`}>
                  ${Number(user.balanceUsd).toLocaleString()}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel-footer">
        {!user ? (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>Connect your wallet to start trading</div>
        ) : (
          <button
            onClick={() => openMutation.mutate()}
            disabled={!canOpen || openMutation.isPending}
            className={`trade-btn ${direction}`}
          >
            {openMutation.isPending ? 'Placing...' : `${direction === 'long' ? '▲ Long' : '▼ Short'} ${market.name.slice(0, 18)}`}
          </button>
        )}
        {error && <div className="panel-error">{error}</div>}
      </div>
    </div>
  );
}
