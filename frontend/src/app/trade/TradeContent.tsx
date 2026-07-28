"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TradePanel } from "@/components/TradePanel";
import { ChartView } from "@/components/ChartView";
import { WatchImage } from "@/components/WatchImage";
import { usd, pct } from "@/lib/format";
import { POLL_MARKET_MS } from "shared/constants";

export default function TradeContent() {
  const { data: marketsData, isLoading } = useQuery({
    queryKey: ["markets"],
    queryFn: () => api.getMarkets(),
    refetchInterval: POLL_MARKET_MS,
  });

  const markets = marketsData?.markets ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const currentId = activeId ?? markets[0]?.marketId ?? null;
  const activeMarket = markets.find((m: any) => m.marketId === currentId) ?? null;

  if (isLoading || markets.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⌚</div>
          Loading markets...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Market Carousel */}
      <div className="market-strip">
        {markets.map((market: any) => {
          const active = market.marketId === currentId;
          const change = market.change24h ?? 0;
          return (
            <button
              key={market.marketId}
              className={`market-card-btn ${active ? 'active' : ''}`}
              onClick={() => setActiveId(market.marketId)}
            >
              <WatchImage marketId={market.marketId} size={40} />
              <div>
                <div className="market-card-name">{market.name.length > 24 ? market.name.slice(0, 22) + '…' : market.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <span className="market-card-price">{usd(market.indexPrice ?? 0)}</span>
                  <span className={`market-card-change ${change >= 0 ? 'text-green' : 'text-red'}`}>
                    {pct(change)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main: Chart + Panel */}
      <div className="main">
        <div className="center">
          {activeMarket ? <ChartView market={activeMarket} /> : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              Select a watch to start trading
            </div>
          )}
        </div>
        <TradePanel market={activeMarket} />
      </div>
    </div>
  );
}
