"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { WatchImage } from "@/components/WatchImage";
import { Icon } from "@/components/Icons";
import { usd, pct } from "@/lib/format";
import { MAX_LEVERAGE, OPEN_FEE_RATE, CLOSE_FEE_RATE, POLL_MARKETS_MS } from "shared/constants";

/** Sparkline from real candles. Returns null when there isn't enough history to be honest. */
function Sparkline({ marketId, up }: { marketId: string; up: boolean }) {
  const { data } = useQuery({
    queryKey: ["candles-spark", marketId],
    queryFn: () => api.getCandles(marketId, "15m", 32),
    staleTime: 60_000,
  });

  const closes: number[] = (data?.candles ?? []).map((c: any) => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 2) return <div className="sparkline" />;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * 100;
    const y = 28 - ((c - min) / range) * 26 - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg className="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={up ? "var(--green)" : "var(--red)"}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [starred, setStarred] = useState<Record<string, boolean>>({});

  const { data: marketsData, isLoading } = useQuery({
    queryKey: ["markets"],
    queryFn: () => api.getMarkets(),
    refetchInterval: POLL_MARKETS_MS,
  });
  const { data: stats } = useQuery({
    queryKey: ["protocol-stats"],
    queryFn: () => api.getProtocolStats(),
    refetchInterval: 15_000,
  });

  const markets = marketsData?.markets ?? [];
  // "Top" by open interest — the honest reading of which markets people are actually in.
  const top = [...markets]
    .sort((a: any, b: any) => (b.openInterestLong + b.openInterestShort) - (a.openInterestLong + a.openInterestShort))
    .slice(0, 5);

  const roundTrip = ((OPEN_FEE_RATE + CLOSE_FEE_RATE) * 100).toFixed(2);
  const avgFunding = stats?.avgFundingRate ?? 0;

  return (
    <div className="home">
      <div className="home-inner">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-text">
            <h1>TRADE THE WORLD&apos;S<br />FINEST WATCHES.<br /><span>FOREVER.</span></h1>
            <p>
              Long or short luxury watches with up to{" "}
              <span className="lev-highlight">{MAX_LEVERAGE}x leverage</span>. No ownership.
              Just opportunities.
            </p>
            <div className="hero-buttons">
              <Link href="/trade" className="btn btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Trade Now <Icon name="arrow-up-right" size={13} />
              </Link>
              <Link href="/markets" className="btn btn-ghost">Explore Markets</Link>
            </div>
          </div>
          {/* Real product shot, stored locally (see public/images/watches/SOURCES.json).
              WatchImage falls back to the drawn dial if the file is ever missing. */}
          <div className="hero-art">
            <WatchImage marketId="rolex-daytona-116500ln" size={300} bare />
          </div>
        </section>

        {/* ── Stats ── */}
        <section className="stats-bar">
          <div className="stat-item">
            <span className="label">Total Volume (24h)</span>
            <span className="value">{stats ? usd(stats.volume24h) : "—"}</span>
            <span className="sub" style={{ color: "var(--text-muted)" }}>
              {stats ? `${stats.trades24h} trades` : " "}
            </span>
          </div>
          <div className="stat-item">
            <span className="label">Open Interest</span>
            <span className="value">{stats ? usd(stats.openInterest) : "—"}</span>
            <span className="sub" style={{ color: "var(--text-muted)" }}>
              {stats ? `${stats.openPositions} open positions` : " "}
            </span>
          </div>
          <div className="stat-item">
            <span className="label">Traders (24h)</span>
            <span className="value">{stats ? stats.uniqueTraders.toLocaleString() : "—"}</span>
            <span className="sub" style={{ color: "var(--text-muted)" }}>
              {stats ? `${stats.marketsTracked} markets` : " "}
            </span>
          </div>
          <div className="stat-item">
            <span className="label">Funding Rate (avg)</span>
            <span className="value">{(avgFunding * 100).toFixed(4)}%</span>
            <span className="sub" style={{ color: "var(--accent)" }}>
              {avgFunding === 0 ? "Neutral" : avgFunding > 0 ? "Longs Pay Shorts" : "Shorts Pay Longs"}
            </span>
          </div>
        </section>

        {/* ── Top perpetuals ── */}
        <section className="panel-box">
          <div className="panel-box-header">
            <h3>Top Watch Perpetuals</h3>
            <Link href="/markets">View All Markets <Icon name="arrow-right" size={12} /></Link>
          </div>

          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 52, borderRadius: 0 }} />
              ))}
            </div>
          ) : (
            <table className="perp-table">
              <thead>
                <tr>
                  <th>Watch</th>
                  <th>Price</th>
                  <th>24h %</th>
                  <th>24h Chart</th>
                  <th>OI</th>
                  <th>Funding</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {top.map((m: any) => {
                  const change = m.change24h ?? 0;
                  const up = change >= 0;
                  const oi = (m.openInterestLong ?? 0) + (m.openInterestShort ?? 0);
                  const funding = m.fundingRate ?? 0;
                  return (
                    <tr key={m.marketId}>
                      <td>
                        <div className="watch-cell">
                          <button
                            className={`star-btn ${starred[m.marketId] ? "active" : ""}`}
                            onClick={() => setStarred((s) => ({ ...s, [m.marketId]: !s[m.marketId] }))}
                            aria-label={starred[m.marketId] ? "Unstar" : "Star"}
                          >
                            <Icon name={starred[m.marketId] ? "star-filled" : "star"} size={14} />
                          </button>
                          <WatchImage marketId={m.marketId} size={34} />
                          <div>
                            <div className="watch-name">{m.name}</div>
                            <div className="watch-ticker">{m.ticker}-PERP</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{usd(m.indexPrice ?? 0)}</td>
                      <td className={`num ${up ? "text-green" : "text-red"}`}>{pct(change)}</td>
                      <td><Sparkline marketId={m.marketId} up={up} /></td>
                      <td className="num">{usd(oi)}</td>
                      <td className={`num ${funding >= 0 ? "text-green" : "text-red"}`}>
                        {(funding * 100).toFixed(4)}%
                      </td>
                      <td>
                        <button
                          className="btn btn-accent-outline"
                          style={{ padding: "5px 14px", fontSize: 12 }}
                          onClick={() => router.push(`/trade?market=${m.marketId}`)}
                        >
                          Trade
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Features ──
            Every claim here is checked against the code. The reference mockup said
            "Non-custodial & Audited" and "0.02% Maker / 0.06% Taker" — both false: this is a
            custodial, unaudited system with a flat fee and no order book. */}
        <section className="features-bar">
          <div className="feature-item">
            <span className="icon"><Icon name="sliders" size={19} /></span>
            <div className="feature-text">
              <h4>{MAX_LEVERAGE}x</h4>
              <p>Max leverage, banded by market liquidity</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="icon"><Icon name="bolt" size={19} /></span>
            <div className="feature-text">
              <h4>{(OPEN_FEE_RATE * 100).toFixed(2)}% flat</h4>
              <p>Open and close. {roundTrip}% round trip on notional</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="icon"><Icon name="shield" size={19} /></span>
            <div className="feature-text">
              <h4>Custodial &amp; unaudited</h4>
              <p>We hold your USDG. Not audited. Experimental</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="icon"><Icon name="clock" size={19} /></span>
            <div className="feature-text">
              <h4>Simulated prices</h4>
              <p>Accelerated clock, not live market data</p>
            </div>
          </div>
        </section>

        <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--text-muted)", padding: "4px 0 12px" }}>
          Experimental software · Not financial advice · Prices are simulated · Not affiliated with
          any watch manufacturer
        </div>
      </div>
    </div>
  );
}
