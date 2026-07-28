import type { MarketConfig } from "shared/types";
import type { PriceQuote, PriceSource } from "./types";

// Stub. Wire this up to a real watch market feed (WatchCharts / Chrono24 / Bezel) and it
// takes over from the simulator automatically — resolvePriceSource picks the first
// available source, so setting WATCHCHARTS_API_KEY is the whole switch.
//
// Vendor slugs live here rather than in the shared catalog on purpose: the catalog keys on
// referenceNumber, which is a fact about the watch, not about whoever is selling data this
// month. A vendor swap should touch this file and nothing else.

const API_KEY = process.env.WATCHCHARTS_API_KEY ?? "";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const WC_SLUG: Record<string, string> = {
  // 'rolex-daytona-116500ln': 'rolex/daytona/116500ln',
};

export const watchChartsSource: PriceSource = {
  id: "watchcharts",

  isAvailable: () => !!API_KEY,

  async fetchMany(_markets: MarketConfig[]): Promise<Map<string, PriceQuote>> {
    // Contract for the real implementation:
    //   - one batched request for all refs, never a per-market await
    //   - partial results are fine; the caller gap-fills the rest from the simulator
    //   - budget ~5s wall clock, and never throw — return what you have
    //   - map each result to PriceQuote with sourceId: "watchcharts"
    return new Map();
  },
};
