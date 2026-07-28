import type { MarketConfig } from "shared/types";

export interface PriceQuote {
  marketId: string;
  price: number;
  bid?: number;
  ask?: number;
  /** 0..1 — surfaces as Market.oracleConfidence. */
  confidence: number;
  observedAt: number;
  imageUrl?: string;
  /** Carried per-quote so one tick can honestly mix a live ref with a simulated one. */
  sourceId: string;
}

export interface PriceSource {
  readonly id: string;
  isAvailable(): boolean;
  /**
   * Batch by contract, not convenience: a per-market fetch invites an await inside the
   * scraper's loop, which is how the old StockX path could stall a 30s tick for 20 minutes.
   *
   * Partial results are expected — no real feed covers every reference — so the caller
   * gap-fills whatever is missing rather than discarding the whole batch. Must not throw.
   */
  fetchMany(markets: MarketConfig[]): Promise<Map<string, PriceQuote>>;
}
