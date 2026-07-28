import type { PriceSource } from "./types";
import { simulatedSource } from "./simulated";
import { watchChartsSource } from "./watchcharts";

export type { PriceQuote, PriceSource } from "./types";
export { simulatedSource, sigmaOverYears, barYears, decayOverYears, gauss, primeState, TICK_MS, TICK_DAYS } from "./simulated";

/** Priority order — first available wins. The simulator is always available, so it anchors the list. */
const SOURCES: PriceSource[] = [watchChartsSource, simulatedSource];

export function resolvePriceSource(): PriceSource {
  return SOURCES.find((s) => s.isAvailable()) ?? simulatedSource;
}

/** Surfaced on /api/admin/health so "are we live or simulated?" is answerable without reading code. */
export function activeSourceId(): string {
  return resolvePriceSource().id;
}
