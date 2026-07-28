import type { MarketCategory, MarketConfig } from './types';

// Leverage bands. Leverage scales inversely with price and illiquidity: a Speedmaster
// clears hundreds of units/month across grey dealers, an RM 011 trades a handful a year.
//   liquid   < $10k, active grey market  → 50
//   core     $10k–$20k                   → 40
//   premium  $20k–$50k                   → 30
//   grail    $50k–$120k                  → 20
//   ultra    > $120k                     → 10
//
// basePrice is the long-run anchor the simulator mean-reverts to. Unlike a live feed it never
// self-corrects, so it is a shipped product surface — a wrong number stays wrong forever.
//
// SOURCED: July 2026, from WatchCharts secondary-market values (median transaction based)
// unless noted. WatchCharts blocks automated fetching (403), so these came from published
// figures rather than a scrape. Re-check quarterly; the market moves.
//
// annualVol is annualised volatility (0.20 = 20%/yr). NOTE: these remain ESTIMATES — see
// the note at the bottom of this file.

export const MARKETS: MarketConfig[] = [
  // $25k model-level; the white "Panda" dial carries a consistent ~$3k premium over black.
  { id: 'rolex-daytona-116500ln', name: 'Rolex Daytona 116500LN (White)', category: 'rolex', brand: 'Rolex', ticker: 'DAYTONA', referenceNumber: '116500LN', imageUrl: '', basePrice: 28000, annualVol: 0.20, maxLeverage: 30, minPositionSize: 1, feeRate: 0.001 },
  { id: 'rolex-submariner-126610ln', name: 'Rolex Submariner Date 126610LN', category: 'rolex', brand: 'Rolex', ticker: 'SUBMARINER', referenceNumber: '126610LN', imageUrl: '', basePrice: 13650, annualVol: 0.16, maxLeverage: 40, minPositionSize: 1, feeRate: 0.001 },
  // Rallied ~+12% in Q1 2026 on discontinuation rumours at Watches & Wonders; eased after Apr 13.
  { id: 'rolex-gmt-pepsi-126710blro', name: 'Rolex GMT-Master II "Pepsi"', category: 'rolex', brand: 'Rolex', ticker: 'PEPSI', referenceNumber: '126710BLRO', imageUrl: '', basePrice: 22500, annualVol: 0.20, maxLeverage: 30, minPositionSize: 1, feeRate: 0.001 },
  // Trades ~22.7% above its $11,650 retail; +11.9% YoY.
  { id: 'rolex-datejust-41-126334', name: 'Rolex Datejust 41 (Blue/Jubilee)', category: 'rolex', brand: 'Rolex', ticker: 'DATEJUST', referenceNumber: '126334', imageUrl: '', basePrice: 14300, annualVol: 0.10, maxLeverage: 40, minPositionSize: 1, feeRate: 0.001 },
  { id: 'rolex-daydate-40-228238', name: 'Rolex Day-Date 40 (Yellow Gold)', category: 'rolex', brand: 'Rolex', ticker: 'DAYDATE', referenceNumber: '228238', imageUrl: '', basePrice: 50000, annualVol: 0.13, maxLeverage: 20, minPositionSize: 1, feeRate: 0.001 },

  // +29.8% YoY. Discontinued 2021, secondary-only.
  { id: 'patek-nautilus-5711-1a', name: 'Patek Philippe Nautilus 5711/1A', category: 'patek', brand: 'Patek Philippe', ticker: 'NAUTILUS', referenceNumber: '5711/1A-010', imageUrl: '', basePrice: 112500, annualVol: 0.28, maxLeverage: 20, minPositionSize: 1, feeRate: 0.001 },
  // +16.0% YoY.
  { id: 'patek-aquanaut-5167a', name: 'Patek Philippe Aquanaut 5167A', category: 'patek', brand: 'Patek Philippe', ticker: 'AQUANAUT', referenceNumber: '5167A-001', imageUrl: '', basePrice: 68700, annualVol: 0.25, maxLeverage: 20, minPositionSize: 1, feeRate: 0.001 },

  // +6.8% YoY. Dealer listings $45.9k–$52k; no WatchCharts headline figure published.
  { id: 'ap-royal-oak-15500st', name: 'AP Royal Oak 15500ST (Blue)', category: 'ap', brand: 'Audemars Piguet', ticker: 'ROYALOAK', referenceNumber: '15500ST.OO.1220ST.01', imageUrl: '', basePrice: 47000, annualVol: 0.24, maxLeverage: 30, minPositionSize: 1, feeRate: 0.001 },
  // +7.5% YoY.
  { id: 'ap-royal-oak-chrono-26331st', name: 'AP Royal Oak Chronograph', category: 'ap', brand: 'Audemars Piguet', ticker: 'ROYALOAKCHR', referenceNumber: '26331ST.OO.1220ST.01', imageUrl: '', basePrice: 42500, annualVol: 0.22, maxLeverage: 30, minPositionSize: 1, feeRate: 0.001 },

  // Trades ~27.8% BELOW its $7,800 retail; -9.0% over 5 years. Hesalite/closed caseback.
  { id: 'omega-speedmaster-pro-3861', name: 'Omega Speedmaster Professional', category: 'omega', brand: 'Omega', ticker: 'SPEEDMASTER', referenceNumber: '310.30.42.50.01.001', imageUrl: '', basePrice: 5650, annualVol: 0.07, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },
  // Trades ~37.7% below its $6,700 retail; +3.3% YoY.
  { id: 'omega-seamaster-300m', name: 'Omega Seamaster Diver 300M', category: 'omega', brand: 'Omega', ticker: 'SEAMASTER', referenceNumber: '210.30.42.20.01.001', imageUrl: '', basePrice: 4200, annualVol: 0.06, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },

  // Trades ~26.3% below its $9,200 retail; +11.5% YoY.
  { id: 'cartier-santos-lg-wssa0018', name: 'Cartier Santos Large', category: 'cartier', brand: 'Cartier', ticker: 'SANTOS', referenceNumber: 'WSSA0018', imageUrl: '', basePrice: 6800, annualVol: 0.09, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },
  // +11.3% YoY. Chrono24 average listing (no WatchCharts headline figure published).
  { id: 'cartier-tank-must-wsta0041', name: 'Cartier Tank Must', category: 'cartier', brand: 'Cartier', ticker: 'TANK', referenceNumber: 'WSTA0041', imageUrl: '', basePrice: 3200, annualVol: 0.08, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },

  // +7.9% YoY. Sells faster than 93% of the market.
  { id: 'tudor-bb58-79030n', name: 'Tudor Black Bay 58', category: 'tudor', brand: 'Tudor', ticker: 'BB58', referenceNumber: 'M79030N-0001', imageUrl: '', basePrice: 2830, annualVol: 0.08, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },
  // Trades ~33.0% below its $5,625 retail.
  { id: 'tudor-pelagos-39', name: 'Tudor Pelagos 39', category: 'tudor', brand: 'Tudor', ticker: 'PELAGOS', referenceNumber: 'M25407N-0001', imageUrl: '', basePrice: 3770, annualVol: 0.09, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },

  // Private-sale avg $4,445 / dealer $4,743 — midpoint. No WatchCharts headline figure.
  { id: 'gs-snowflake-sbga211', name: 'Grand Seiko "Snowflake"', category: 'grand-seiko', brand: 'Grand Seiko', ticker: 'SNOWFLAKE', referenceNumber: 'SBGA211', imageUrl: '', basePrice: 4600, annualVol: 0.07, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },
  // Trades ~35.1% below its $9,800 retail.
  { id: 'gs-white-birch-slgh005', name: 'Grand Seiko "White Birch"', category: 'grand-seiko', brand: 'Grand Seiko', ticker: 'WHITEBIRCH', referenceNumber: 'SLGH005', imageUrl: '', basePrice: 6350, annualVol: 0.12, maxLeverage: 50, minPositionSize: 1, feeRate: 0.001 },

  { id: 'vc-overseas-4500v', name: 'Vacheron Constantin Overseas', category: 'haute', brand: 'Vacheron Constantin', ticker: 'OVERSEAS', referenceNumber: '4500V/110A-B128', imageUrl: '', basePrice: 26000, annualVol: 0.15, maxLeverage: 30, minPositionSize: 1, feeRate: 0.001 },
  { id: 'lange-zeitwerk-140-029', name: 'A. Lange & Söhne Zeitwerk', category: 'haute', brand: 'A. Lange & Söhne', ticker: 'ZEITWERK', referenceNumber: '140.029', imageUrl: '', basePrice: 59500, annualVol: 0.14, maxLeverage: 20, minPositionSize: 1, feeRate: 0.001 },
  // LOW CONFIDENCE. No median-transaction source; dealer asks span $165k-$328k depending on
  // case material and condition. Titanium clusters ~$210k-$282k. It trades a handful of times
  // a year, so there is no tight "market price" to be had — hence the 10x cap.
  { id: 'rm-011-felipe-massa', name: 'Richard Mille RM 011 Felipe Massa', category: 'haute', brand: 'Richard Mille', ticker: 'RM011', referenceNumber: 'RM 011', imageUrl: '', basePrice: 230000, annualVol: 0.30, maxLeverage: 10, minPositionSize: 1, feeRate: 0.001 },
];

// ── On annualVol ──
//
// DO NOT calibrate these against WatchCharts' published "market volatility" figure. It is not
// time-series volatility. It measures CROSS-SECTIONAL DISPERSION — how far prices spread across
// different sales of the same reference at one point in time, driven by condition, box/papers
// and thin inventory. Their docs: "higher volatility indicates that there is a greater spread of
// prices for a watch, which could be a result of a limited amount of available inventory, or
// specific details which lead to significant differences in pricing", and "vintage watches tend
// to have higher volatility as condition and the inclusion of box/papers affect valuation more
// significantly". So AP 15500ST's "9.4%" means every example trades near the same price — not
// that the price is stable over time. Copying it into annualVol is a category error.
//
// What the evidence actually supports (July 2026):
//   - Journal of Investment Strategies (1999-2020, two decades pre-pandemic): collectible
//     watches returned 5.5% real / 7.7% nominal annualised, with "comparably low standard
//     deviations" and Sharpe ratios beaten only by gold. A small watch allocation cut a
//     portfolio's vol from 13.4% to 12.1%, which bounds index-level vol below ~13%.
//   - Post-2020 has been far more volatile than that baseline: the market peaked ~March 2022,
//     then fell for 9 consecutive quarters. The WatchCharts Overall Index ran -9.4% YoY in 2024
//     and +8.2% YoY as of March 2026. Individual names swung much harder — the Daytona
//     116500LN peaked near $50k in 2022 against ~$28k today.
//   - Single-name 1yr returns as of July 2026 spread from +3.3% (Seamaster) to +29.8%
//     (Nautilus) around an index of +8.2% — roughly 7-8% of idiosyncratic dispersion on top of
//     ~12% index vol, implying ~14% total annual vol for a typical reference.
//
// The values above span 0.06-0.30 with a median near 0.13, which is consistent with that.
// The structure is deliberate: pieces trading BELOW retail (Omega, Tudor, Grand Seiko) are
// anchored by new supply — retail caps the upside, production cost floors the downside — so
// they genuinely cannot move much. Steel sports watches at a premium (Daytona, Nautilus,
// Royal Oak) are the speculative end and carry the bubble/crash history to prove it.
//
// These remain ESTIMATES. A real calibration needs the underlying transaction time series,
// which no free source exposes — WatchCharts 403s automated fetching and publishes no
// annualised return volatility. That is a paid-API job, same as the live price feed.

export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  'rolex': 'Rolex',
  'patek': 'Patek Philippe',
  'ap': 'Audemars Piguet',
  'omega': 'Omega',
  'cartier': 'Cartier',
  'tudor': 'Tudor',
  'grand-seiko': 'Grand Seiko',
  'haute': 'Haute Horlogerie',
};

export function getMarketById(id: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.id === id);
}

export function getMarketsByCategory(category: MarketCategory): MarketConfig[] {
  return MARKETS.filter((m) => m.category === category);
}
