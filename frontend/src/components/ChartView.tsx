"use client";

import { useRef, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, ColorType } from "lightweight-charts";
import { api } from "@/lib/api";
import { CANDLE_RESOLUTIONS, type CandleResolution } from "shared/constants";
import { useAuth } from "@/hooks/useAuth";

interface Props { market: any; }

type ChartType = "candles" | "line";

/* Inline glyphs for the chart-type toggle — the shared Icon set has no candlestick shape and
   two 14px SVGs are cheaper than adding one. */
function CandlesGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M7 3v4M7 17v4M17 3v6M17 15v6" />
      <rect x="4.5" y="7" width="5" height="10" rx="0.5" />
      <rect x="14.5" y="9" width="5" height="6" rx="0.5" />
    </svg>
  );
}

function LineGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l5-6 4 3 4-7 5 5" />
    </svg>
  );
}

export function ChartView({ market }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any>(null);
  /** Guards auto-fit so a 15s poll never yanks the viewport back from the user's zoom. */
  const fittedRef = useRef(false);
  const [resolution, setResolution] = useState<CandleResolution>("1h");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const { user } = useAuth();

  const { data: candlesData } = useQuery({
    queryKey: ["candles", market.marketId, resolution],
    queryFn: () => api.getCandles(market.marketId, resolution),
    refetchInterval: 15000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ["recentTrades", market.marketId],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${market.marketId}/trades/recent?limit=15`);
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: positionsData } = useQuery({
    queryKey: ["positions"], queryFn: () => api.getPositions(),
    enabled: !!user, refetchInterval: 5000,
  });

  const price = market.indexPrice ?? 0;
  const change = market.change24h ?? 0;
  const vol = market.volume24h ?? 0;
  const oi = (market.openInterestLong ?? 0) + (market.openInterestShort ?? 0);
  const candles = candlesData?.candles ?? [];
  const recentTrades = tradesData?.trades ?? [];
  const positions = positionsData?.positions ?? [];
  const openPositions = positions.filter((p: any) => p.status === "open");

  // Create the chart ONCE and keep it. The previous version rebuilt the whole chart inside a
  // [candles] effect, so every 15s refetch destroyed it and threw away the user's zoom and pan
  // — you could not stay zoomed into a move for longer than one poll. Data now flows through a
  // separate effect that only calls setData.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8e8e9c",
        fontFamily: "var(--mono), ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      // Magnet: the crosshair snaps to OHLC values, which is what TradingView does and what
      // makes reading a candle's exact high/low possible.
      crosshair: {
        mode: 1,
        vertLine: { color: "rgba(225,255,0,0.35)", width: 1, style: 2, labelBackgroundColor: "#e1ff00" },
        horzLine: { color: "rgba(225,255,0,0.35)", width: 1, style: 2, labelBackgroundColor: "#e1ff00" },
      },
      timeScale: {
        borderColor: "#24242e",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      rightPriceScale: {
        borderColor: "#24242e",
        // Leave room at the bottom for the volume histogram to sit under the price action.
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      localization: {
        // Must match the header's formatting exactly. This previously dropped the decimals
        // above 1000 to keep the axis narrow, which made the chart disagree with the price
        // shown right above it — the header read $29,263.77 while the axis and crosshair read
        // 29,264. On a trading screen two different numbers for the same price is a bug
        // report, not a rounding preference.
        priceFormatter: (p: number) =>
          p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
      // Mobile: `handleScroll: true` enables vertical touch-drag too, which fights the page's
      // own scroll. The browser wins that fight, so dragging the chart just scrolled the page
      // and the chart appeared frozen — "it doesn't move at all". Vertical drags are handed
      // back to the page; horizontal drags pan the chart and pinch still zooms. Paired with
      // `touch-action: pan-y` on the container in globals.css.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00ff66",
      downColor: "#ff3e3e",
      borderUpColor: "#00ff66",
      borderDownColor: "#ff3e3e",
      wickUpColor: "rgba(0,255,102,0.75)",
      wickDownColor: "rgba(255,62,62,0.75)",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    // Volume in its own overlay scale pinned to the bottom quarter — same layout TradingView
    // uses, and it keeps volume from compressing the price axis.
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    lineSeriesRef.current = null;
    fittedRef.current = false;

    let disposed = false;
    const ro = new ResizeObserver(() => {
      if (disposed || !container) return;
      try {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      } catch {}
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      try { chart.remove(); } catch {}
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
  }, []);

  // Swap between candles and line without tearing down the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (chartType === "line" && !lineSeriesRef.current) {
      lineSeriesRef.current = chart.addAreaSeries({
        lineColor: "#e1ff00",
        topColor: "rgba(225,255,0,0.14)",
        bottomColor: "rgba(225,255,0,0)",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
    }
    if (chartType === "candles" && lineSeriesRef.current) {
      try { chart.removeSeries(lineSeriesRef.current); } catch {}
      lineSeriesRef.current = null;
    }
    try {
      candleSeriesRef.current?.applyOptions({ visible: chartType === "candles" });
    } catch {}
  }, [chartType]);

  // Feed data. Separate from creation so a refetch updates in place and the viewport survives.
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    const ohlc = candles.map((c: any) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    try {
      candleSeriesRef.current?.setData(ohlc);
      lineSeriesRef.current?.setData(candles.map((c: any) => ({ time: c.time, value: c.close })));
      volumeSeriesRef.current?.setData(
        candles.map((c: any) => ({
          time: c.time,
          value: c.volume ?? 0,
          color: c.close >= c.open ? "rgba(0,255,102,0.28)" : "rgba(255,62,62,0.28)",
        })),
      );
      // Only auto-fit the first time a market/resolution loads. Re-fitting on every poll would
      // yank the view back and undo any zoom the user just made.
      if (!fittedRef.current) {
        chartRef.current.timeScale().fitContent();
        fittedRef.current = true;
      }
    } catch {}
  }, [candles, chartType]);

  // A new market or timeframe is a genuinely different dataset — re-fit for that.
  useEffect(() => {
    fittedRef.current = false;
  }, [market.marketId, resolution]);

  return (
    <>
      {/* Price Header */}
      <div className="chart-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="chart-price">
              ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`chart-change ${change >= 0 ? 'text-green' : 'text-red'}`}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </span>
          </div>
          <div className="chart-name">{market.name}</div>
        </div>
      </div>

      {/* Chart.
          The container is ALWAYS mounted — the chart is created once in a []-deps effect, so
          rendering it conditionally on candles.length would leave containerRef null at mount
          and the chart would never be created at all. The loading state overlays instead. */}
      <div className="chart-area" style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {candles.length < 2 && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none',
            }}
          >
            Loading chart data…
          </div>
        )}
      </div>

      {/* Timeframes + chart type */}
      <div className="chart-tf">
        {CANDLE_RESOLUTIONS.map((r) => (
          <button key={r} className={resolution === r ? 'active' : ''} onClick={() => setResolution(r)}>{r}</button>
        ))}
        <span className="chart-tf-sep" />
        <button
          className={chartType === 'candles' ? 'active' : ''}
          onClick={() => setChartType('candles')}
          title="Candlestick"
          aria-label="Candlestick chart"
        >
          <CandlesGlyph />
        </button>
        <button
          className={chartType === 'line' ? 'active' : ''}
          onClick={() => setChartType('line')}
          title="Line"
          aria-label="Line chart"
        >
          <LineGlyph />
        </button>
      </div>

      {/* Stats */}
      <div className="chart-stats">
        {[["24h Vol", `$${vol.toLocaleString()}`], ["Open Interest", `$${oi.toLocaleString()}`], ["Funding", `${((market.fundingRate ?? 0) * 100).toFixed(4)}%`], ["Max Leverage", `${market.maxLeverage ?? 25}x`]].map(([l, v]) => (
          <div key={l} className="chart-stat">{l}<strong>{v}</strong></div>
        ))}
      </div>

      {/* Recent Trades */}
      <div style={{ display: 'flex', gap: 8, margin: '0 16px 8px' }}>
        <div style={{ flex: 1, borderRadius: 'var(--radius)', background: 'var(--card)', padding: '6px 14px', maxHeight: 120, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Recent Trades</div>
          {recentTrades.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>No trades yet</div>
          ) : recentTrades.slice(0, 8).map((t: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{new Date(t.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`mono ${t.direction === 'long' ? 'text-green' : 'text-red'}`}>{t.direction === 'long' ? '▲' : '▼'} ${Number(t.price).toFixed(2)}</span>
              <span className="mono" style={{ color: 'var(--text-secondary)' }}>${Number(t.size).toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Open Positions mini */}
        {openPositions.length > 0 && (
          <div style={{ flex: 1, borderRadius: 'var(--radius)', background: 'var(--card)', padding: '6px 14px', maxHeight: 120, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Your Positions</div>
            {openPositions.map((p: any) => {
              const pnl = p.unrealizedPnl ?? 0;
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
                  <span className={`pos-badge ${p.direction}`} style={{ fontSize: 9 }}>{p.direction.toUpperCase()} {p.leverage}x</span>
                  <span className="mono" style={{ color: 'var(--text-secondary)' }}>${Number(p.collateral).toLocaleString()}</span>
                  <span className={`mono ${pnl >= 0 ? 'text-green' : 'text-red'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
