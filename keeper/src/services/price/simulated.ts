import type { MarketConfig } from "shared/types";
import type { PriceQuote, PriceSource } from "./types";

// Ornstein-Uhlenbeck in log-price: mean-reverts to basePrice, so the series has no drift
// and stays positive. Volatility comes from each market's annualVol, so a Speedmaster and
// an RM 011 move at their own real relative scales.
//
// Compressed clock: one tick advances one simulated day. At true wall-clock speed a Daytona
// moves ~0.02% per tick and the whole board renders 0.0% forever. TICK_DAYS is the single
// constant trading chart liveliness against clock realism — the per-watch volatility shape
// is preserved either way.

export const TICK_DAYS = 1;
/** Must match the scraper's setInterval in keeper/src/index.ts. */
export const TICK_MS = 30_000;

const DAYS_PER_YEAR = 365;
const DT = TICK_DAYS / DAYS_PER_YEAR;
const THETA = 2.0; // mean-reversion speed (~4 month half-life)

/**
 * Raw log-price, deliberately private to this adapter and NOT the scraper's ewmaState.
 * The old randomWalk read ewmaState as its own previous value, so the walk fed on its own
 * smoothed output — which both amplified drift and left EWMA with no raw signal to filter.
 */
const state: Record<string, number> = {};

/** Box-Muller. Math.random() is uniform; an OU step needs a normal. */
export function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Exact OU standard deviation over a horizon, in log space:
 *
 *   sd(t) = annualVol × sqrt( (1 − e^(−2θt)) / 2θ )
 *
 * The naive annualVol×sqrt(t) is only the short-horizon limit and diverges without bound —
 * it would put 56% moves on a seeded 1d bar. Mean reversion caps the real spread at the
 * stationary sd, annualVol/sqrt(2θ) (10% for a Daytona), which is what long bars converge to.
 */
export function sigmaOverYears(annualVol: number, tYears: number): number {
  return annualVol * Math.sqrt((1 - Math.exp(-2 * THETA * tYears)) / (2 * THETA));
}

/** Real bar duration → simulated horizon, on the compressed clock. */
export function barYears(barMs: number): number {
  return ((barMs / TICK_MS) * TICK_DAYS) / DAYS_PER_YEAR;
}

/** Exact OU decay factor over a horizon — how far the level pulls back toward the anchor. */
export function decayOverYears(tYears: number): number {
  return Math.exp(-THETA * tYears);
}

function step(m: MarketConfig): number {
  const anchor = Math.log(m.basePrice);
  const x = state[m.id] ?? anchor;
  const next = x + THETA * (anchor - x) * DT + sigmaOverYears(m.annualVol, DT) * gauss();
  state[m.id] = next;
  return Math.exp(next);
}

/** Lets the candle seeder hand the live walk a warm starting level instead of the anchor. */
export function primeState(marketId: string, price: number): void {
  state[marketId] = Math.log(price);
}

export const simulatedSource: PriceSource = {
  id: "simulated",

  isAvailable: () => true,

  async fetchMany(markets: MarketConfig[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    const observedAt = Date.now();
    for (const m of markets) {
      out.set(m.id, {
        marketId: m.id,
        price: step(m),
        confidence: 1,
        observedAt,
        sourceId: "simulated",
      });
    }
    return out;
  },
};
