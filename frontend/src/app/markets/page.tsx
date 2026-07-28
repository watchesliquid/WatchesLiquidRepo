"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { CATEGORY_LABELS } from "shared/markets";
import type { MarketCategory } from "shared/types";
import { POLL_MARKETS_MS } from "shared/constants";
import { WatchImage } from "@/components/WatchImage";
import { usd, pct } from "@/lib/format";

export default function MarketsPage() {
  const router = useRouter();
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("volume");

  const { data, isLoading } = useQuery({
    queryKey: ["markets"],
    queryFn: () => api.getMarkets(),
    refetchInterval: POLL_MARKETS_MS,
  });

  const markets = data?.markets ?? [];
  const categories = ["all", ...new Set(markets.map((m: any) => m.category))];

  const filtered = category === "all" ? markets : markets.filter((m: any) => m.category === category);
  const sorted = [...filtered].sort((a: any, b: any) => {
    if (sort === "price-desc") return b.indexPrice - a.indexPrice;
    if (sort === "price-asc") return a.indexPrice - b.indexPrice;
    if (sort === "change") return Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0);
    return (b.volume24h ?? 0) - (a.volume24h ?? 0);
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Markets</h1>
          <p className="page-subtitle">Luxury watch perpetual futures</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', borderRadius: 0, overflow: 'hidden', background: 'var(--card)' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '7px 14px', fontSize: 11, fontWeight: 500,
                  color: category === cat ? 'var(--text)' : 'var(--text-secondary)',
                  background: category === cat ? 'var(--hover)' : 'transparent',
                }}
              >
                {cat === "all" ? "All" : CATEGORY_LABELS[cat as MarketCategory] ?? cat}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 0, color: 'var(--text)', fontSize: 12, padding: '6px 10px' }}
          >
            <option value="volume">Volume</option>
            <option value="price-desc">Price ↓</option>
            <option value="price-asc">Price ↑</option>
            <option value="change">24h Change</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="markets-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 180, borderRadius: 0 }} />
          ))}
        </div>
      ) : (
        <div className="markets-grid">
          {sorted.map((market: any) => {
            const change = market.change24h ?? 0;
            return (
              <button
                key={market.marketId}
                onClick={() => router.push(`/trade?market=${market.marketId}`)}
                className="mkt-card"
              >
                <div className="mkt-card-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)' }}>
                  <WatchImage marketId={market.marketId} size={80} />
                </div>
                <div className="mkt-card-name">{market.name.length > 28 ? market.name.slice(0, 26) + '…' : market.name}</div>
                {market.referenceNumber && <div className="mkt-card-ref">Ref. {market.referenceNumber}</div>}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="mkt-card-price">{usd(market.indexPrice ?? 0)}</span>
                  <span className={`mkt-card-change ${change >= 0 ? 'text-green' : 'text-red'}`}>
                    {pct(change)}
                  </span>
                </div>
                <div className="mkt-card-footer">
                  <span>Vol: {usd(market.volume24h ?? 0)}</span>
                  <span>{market.maxLeverage}x</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
