"use client";

import Link from "next/link";
import { CATEGORY_LABELS } from "shared/markets";
import type { MarketCategory } from "shared/types";
import { WatchImage } from "./WatchImage";
import { usd, pct } from "../lib/format";

interface Props {
  markets: any[];
  isLoading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
}

const ICONS: Record<MarketCategory, string> = {
  rolex: "👑", patek: "💎", ap: "🛡️", omega: "🚀",
  cartier: "🔴", tudor: "🌊", "grand-seiko": "❄️", haute: "⚙️",
};

export function MarketSidebar({ markets, isLoading, activeId, onSelect }: Props) {
  const categories = [...new Set(markets.map((m: any) => m.category))];
  const activeMarket = markets.find((m: any) => m.marketId === activeId);

  if (isLoading) {
    return (
      <aside className="sidebar">
        <div className="sidebar-search"><input disabled placeholder="Loading..." /></div>
        <div className="sidebar-list">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 0 }} />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <input type="search" placeholder="Search watches..." spellCheck={false} />
      </div>

      <div className="sidebar-cats">
        {categories.map((cat: MarketCategory) => {
          const isActive = activeMarket?.category === cat;
          return (
            <button
              key={cat}
              className={`sidebar-cat ${isActive ? 'active' : ''}`}
              onClick={() => {
                const first = markets.find((m: any) => m.category === cat);
                if (first) onSelect(first.marketId);
              }}
            >
              {ICONS[cat] ?? "📦"} {CATEGORY_LABELS[cat] ?? cat}
            </button>
          );
        })}
      </div>

      <div className="sidebar-list">
        {markets.map((market: any) => {
          const active = activeId === market.marketId;
          const change = market.change24h ?? 0;
          const price = market.indexPrice ?? 0;
          return (
            <button
              key={market.marketId}
              className={`sidebar-item ${active ? 'active' : ''}`}
              onClick={() => onSelect(market.marketId)}
            >
              <div className="sidebar-item-icon" style={{ overflow: 'hidden' }}>
                <WatchImage marketId={market.marketId} size={34} />
              </div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-name">{market.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <span className="sidebar-item-price">{usd(price)}</span>
                  <span className={`sidebar-item-change ${change >= 0 ? 'text-green' : 'text-red'}`}>
                    {pct(change)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Link href="/markets" className="sidebar-footer">All markets →</Link>
    </aside>
  );
}
