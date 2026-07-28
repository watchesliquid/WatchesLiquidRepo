import { memDb } from "../db/memory";
import { EWMA_BASE_ALPHA, EWMA_HIGH_ALPHA, EWMA_DEVIATION_THRESHOLD, CANDLE_RESOLUTION_MS } from "shared/constants";
import type { CandleResolution } from "shared/constants";
import { getMarketById } from "shared/markets";
import type { MarketConfig } from "shared/types";
import type { PriceQuote } from "./price";
import { resolvePriceSource, simulatedSource, sigmaOverYears, barYears, decayOverYears, gauss, primeState } from "./price";

const ewmaState: Record<string, number> = {};

const primary = resolvePriceSource();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("price source timeout")), ms)),
  ]);
}

export async function scrapeAllMarkets(): Promise<number> {
  const active = memDb.markets.filter((m: any) => m.is_active);
  const configs = active
    .map((m: any) => getMarketById(m.id))
    .filter((c: MarketConfig | undefined): c is MarketConfig => !!c);

  // One batched call for every market, then gap-fill whatever the source didn't cover.
  let quotes = new Map<string, PriceQuote>();
  try {
    quotes = await withTimeout(primary.fetchMany(configs), 10_000);
  } catch (err) {
    console.error(`[scraper] ${primary.id} failed, falling back to simulated:`, err);
  }

  const gaps = configs.filter((c) => !quotes.has(c.id));
  if (gaps.length && primary.id !== simulatedSource.id) {
    for (const [k, v] of await simulatedSource.fetchMany(gaps)) quotes.set(k, v);
  }

  let updated = 0;

  for (const market of active) {
    const quote = quotes.get(market.id);
    if (!quote) continue;

    const rawPrice = quote.price;
    const source = quote.sourceId;
    if (quote.imageUrl) (market as any).image_url = quote.imageUrl;

    // Adaptive EWMA
    const prevEwma = ewmaState[market.id];
    let alpha = EWMA_BASE_ALPHA;
    if (prevEwma !== undefined) {
      const deviation = Math.abs(rawPrice - prevEwma) / prevEwma;
      if (deviation > EWMA_DEVIATION_THRESHOLD) alpha = EWMA_HIGH_ALPHA;
    }

    const smoothed = prevEwma !== undefined
      ? alpha * rawPrice + (1 - alpha) * prevEwma
      : rawPrice;

    ewmaState[market.id] = smoothed;

    // Store price tick
    memDb.prices.push({
      market_id: market.id,
      price: String(smoothed),
      source,
      recorded_at: new Date().toISOString(),
    });
    // Keep only last 1000 ticks
    if (memDb.prices.length > 1000 * memDb.markets.length) {
      memDb.prices = memDb.prices.slice(-500 * memDb.markets.length);
    }

    // Update market
    market.index_price = String(smoothed);
    market.mark_price = String(smoothed);

    updated++;
  }

  return updated;
}

/**
 * Close of the newest candle strictly older than `beforeMs`, or null if there is none.
 *
 * Scans from the end because candles are appended chronologically, so the match is normally
 * within the last few entries rather than 50k deep.
 */
function previousCandleClose(marketId: string, resolution: string, beforeMs: number): number | null {
  for (let i = memDb.candles.length - 1; i >= 0; i--) {
    const c: any = memDb.candles[i];
    if (c.market_id !== marketId || c.resolution !== resolution) continue;
    if (new Date(c.open_time).getTime() >= beforeMs) continue;
    const v = Number(c.close);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export async function buildCandles(): Promise<void> {
  const resolutions: { key: CandleResolution; ms: number; lookback: number }[] = [
    { key: "1m", ms: 60_000, lookback: 5 * 60_000 },
    { key: "5m", ms: 5 * 60_000, lookback: 30 * 60_000 },
    { key: "15m", ms: 15 * 60_000, lookback: 90 * 60_000 },
    { key: "1h", ms: 60 * 60_000, lookback: 6 * 60 * 60_000 },
    { key: "4h", ms: 4 * 60 * 60_000, lookback: 24 * 60 * 60_000 },
    { key: "1d", ms: 24 * 60 * 60_000, lookback: 7 * 24 * 60 * 60_000 },
  ];

  const now = Date.now();

  for (const market of memDb.markets) {
    if (!market.is_active) continue;

    for (const res of resolutions) {
      const lookbackTime = now - res.lookback;
      const ticks = memDb.prices
        .filter((p: any) => p.market_id === market.id)
        .filter((p: any) => new Date(p.recorded_at).getTime() >= lookbackTime);

      if (ticks.length < 2) continue;

      // Buckets must be ALIGNED to the resolution grid, not a trailing window.
      //
      // This was `now - res.ms`, which slid forward on every 30s run: `findIndex` below could
      // never match an existing candle, so a brand-new candle was pushed every tick, and each
      // one's body spanned the whole trailing period (open = price one full period ago,
      // close = now). Consecutive candles therefore overlapped almost entirely and the chart
      // rendered as a ribbon of enormous bodies instead of discrete bars.
      //
      // Flooring to the grid gives one candle per period: it is updated in place while the
      // period is open and a new one starts only when the period rolls over.
      const bucketStart = Math.floor(now / res.ms) * res.ms;
      const bucketEnd = bucketStart + res.ms;
      const bucketTicks = ticks.filter((t: any) => {
        const time = new Date(t.recorded_at).getTime();
        return time >= bucketStart && time < bucketEnd;
      });

      if (bucketTicks.length === 0) continue;

      // Recomputed from the full set of ticks in the bucket every pass, so the open candle is
      // always self-consistent (and self-healing) rather than accumulated incrementally.
      const prices = bucketTicks.map((t: any) => Number(t.price));
      const close = prices[prices.length - 1];
      const volume = bucketTicks.length;

      // A new bar opens where the previous bar closed, not at its own first tick.
      //
      // The first tick of a bucket is one 30s step AFTER the last tick of the previous bucket,
      // so taking it as the open left a visible hole between every pair of bodies (~0.4% on the
      // Daytona, on every single bar boundary). The underlying price series is continuous by
      // construction, so those holes were a bucketing artefact, not real price action.
      const prevClose = previousCandleClose(market.id, res.key, bucketStart);
      const open = prevClose ?? prices[0];

      // The open must lie inside the bar's range, or the candle renders inverted.
      const high = Math.max(...prices, open);
      const low = Math.min(...prices, open);

      // Find existing candle or add new one
      const existingIdx = memDb.candles.findIndex(
        (c: any) =>
          c.market_id === market.id &&
          c.resolution === res.key &&
          new Date(c.open_time).getTime() === bucketStart,
      );

      if (existingIdx >= 0) {
        // SET, don't accumulate. high/low/volume are already derived from every tick in the
        // bucket, so `c.volume + volume` would re-add the same ticks on each 30s pass and
        // inflate volume without bound while the period stayed open.
        const c = memDb.candles[existingIdx];
        c.open = String(open);
        c.high = String(high);
        c.low = String(low);
        c.close = String(close);
        c.volume = String(volume);
        c.close_time = new Date(now).toISOString();
      } else {
        memDb.candles.push({
          market_id: market.id,
          resolution: res.key,
          open: String(open),
          high: String(high),
          low: String(low),
          close: String(close),
          volume: String(volume),
          open_time: new Date(bucketStart).toISOString(),
          close_time: new Date(now).toISOString(),
        });
      }
    }
  }

  // Keep candle count manageable
  if (memDb.candles.length > 50000) {
    memDb.candles = memDb.candles.slice(-30000);
  }
}

export function getEwmaSnapshot(): Record<string, number> {
  return { ...ewmaState };
}

// Compute 24h stats (volume, change%, high, low)
export function compute24hStats(): void {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  for (const market of memDb.markets) {
    if (!market.is_active) continue;

    // 24h volume from trades
    const recentTrades = memDb.trades.filter(
      (t: any) => t.market_id === market.id && new Date(t.created_at).getTime() >= cutoff,
    );
    const volume24h = recentTrades.reduce((s: number, t: any) => s + Number(t.size), 0);

    // Price change from oldest price in window
    const recentPrices = (memDb.prices as any[])
      .filter((p: any) => p.market_id === market.id && new Date(p.recorded_at).getTime() >= cutoff)
      .sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

    const prices = recentPrices.map((p: any) => Number(p.price));
    const high24h = prices.length ? Math.max(...prices) : Number(market.index_price);
    const low24h = prices.length ? Math.min(...prices) : Number(market.index_price);
    const open24h = prices.length ? prices[0] : Number(market.index_price);
    const change24h = open24h ? ((Number(market.index_price) - open24h) / open24h) * 100 : 0;

    // Store on market object for API
    (market as any)._volume24h = volume24h;
    (market as any)._trades24h = recentTrades.length;
    (market as any)._high24h = high24h;
    (market as any)._low24h = low24h;
    (market as any)._change24h = change24h;
  }
}

// Seed 24h of historical candles so charts show immediately
/** ms per resolution key — the one place the mapping is written down. */
const RESOLUTION_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/**
 * Drop candles whose open_time is not aligned to their resolution grid.
 *
 * Everything written before the bucketing fix is misaligned: live candles used a trailing
 * `now - res.ms` window and the seeder used `now - i * res.ms` from an arbitrary `now`. Those
 * rows render as a ribbon of overlapping, oversized bodies and would never be updated in place
 * by the corrected code, so they have to go. Candles are derived data — they are rebuilt from
 * the simulator — so dropping them costs nothing. User balances are untouched.
 */
function purgeMisalignedCandles(): void {
  const before = memDb.candles.length;
  memDb.candles = memDb.candles.filter((c: any) => {
    const ms = RESOLUTION_MS[c.resolution];
    if (!ms) return false;
    return new Date(c.open_time).getTime() % ms === 0;
  });
  const dropped = before - memDb.candles.length;
  if (dropped > 0) console.log(`[scraper] dropped ${dropped} misaligned candles (pre-grid-fix data)`);
}

export function seedHistoricalCandles(): void {
  purgeMisalignedCandles();

  // Only seed once
  if (memDb.candles.length > 0) return;

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const resolutions = [
    { key: "15m", ms: 15 * 60_000, count: 96 },   // 24h of 15m
    { key: "1h", ms: HOUR, count: 48 },             // 48h of 1h
    { key: "4h", ms: 4 * HOUR, count: 42 },         // 7d of 4h
    { key: "1d", ms: 24 * HOUR, count: 30 },        // 30d of 1d
  ];

  for (const market of memDb.markets) {
    if (!market.is_active) continue;

    const cfg = getMarketById(market.id);
    if (!cfg) continue;

    const basePrice = cfg.basePrice;
    const anchor = Math.log(basePrice);

    // ONE starting price per market, shared by every resolution AND by the live walk below.
    //
    // Previously each resolution seeded its own independent walk and the live walk was then
    // primed with a THIRD independent draw. So the 15m and 1h charts told different stories
    // about the same watch, and there was a hard jump where seeded history met live data — a
    // measured -13.7% break on the 15m series. Pinning everything to one price removes both.
    const startPrice = Math.exp(anchor + sigmaOverYears(cfg.annualVol, Infinity) * gauss());

    for (const res of resolutions) {
      // Each bar is one exact OU transition over its own simulated horizon, so the seeded
      // history has the same dynamics as the live walk rather than a different fake.
      const tYears = barYears(res.ms);
      const decay = decayOverYears(tYears);
      const sigmaBar = sigmaOverYears(cfg.annualVol, tYears);
      const gridNow = Math.floor(now / res.ms) * res.ms;

      // Walk BACKWARD from the right edge. Two things fall out of this that a forward walk
      // could not give us:
      //   1. Each bar's open becomes the previous (older) bar's close, so close[i-1] === open[i]
      //      exactly and the series has no holes between bodies.
      //   2. The newest bar closes at exactly `startPrice`, which is where the live walk starts,
      //      so there is no seam at the hand-off.
      // (OU is near time-reversible, so reusing the forward transition backwards produces a
      // statistically sound series for a simulator.)
      const bars: any[] = [];
      let logClose = Math.log(startPrice);

      for (let i = 1; i <= res.count; i++) {
        const logOpen = anchor + (logClose - anchor) * decay + sigmaBar * gauss();
        const open = Math.exp(logOpen);
        const close = Math.exp(logClose);

        // Wicks scale with the bar's own sigma. A flat ±1.5% made every 15m watch candle
        // pure wick with an invisible body.
        const high = Math.max(open, close) * (1 + Math.random() * sigmaBar * 0.4);
        const low = Math.min(open, close) * (1 - Math.random() * sigmaBar * 0.4);

        bars.push({
          market_id: market.id,
          resolution: res.key,
          open: String(open),
          high: String(high),
          low: String(low),
          close: String(close),
          volume: String(Math.floor(Math.random() * 800 + 50)),
          open_time: new Date(gridNow - i * res.ms).toISOString(),
          close_time: new Date(gridNow - (i - 1) * res.ms).toISOString(),
        });

        logClose = logOpen; // the next (older) bar closes where this one opened
      }

      // Built newest-first; store chronologically.
      bars.reverse();
      for (const b of bars) memDb.candles.push(b);
    }

    // Hand the live walk the exact level the seeded history ended on.
    //
    // This previously drew a FRESH independent value here despite the comment claiming
    // otherwise, so the live series started somewhere unrelated to where every seeded chart
    // finished — a hard, permanent break at the hand-off (measured at -13.7% on the 15m
    // Daytona). `startPrice` is by construction the close of the newest seeded bar on every
    // resolution, so the join is now continuous.
    market.index_price = String(startPrice);
    market.mark_price = String(startPrice);
    ewmaState[market.id] = startPrice;
    primeState(market.id, startPrice);
  }

  console.log(`[scraper] Seeded ${memDb.candles.length} historical candles across all markets`);
}
