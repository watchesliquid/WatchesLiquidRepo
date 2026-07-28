/**
 * Watch prices span $2.9k to $180k, which is 10-100x the sneaker range the UI was built for.
 * A raw toFixed(2) renders the RM 011 as "180000.00" and blows the price cell's layout, so
 * anything above $10k gets compacted.
 */
export function usd(amount: number): string {
  if (!isFinite(amount)) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(amount / 1_000).toFixed(1)}k`;
  if (abs >= 100) return `$${amount.toFixed(0)}`;
  return `$${amount.toFixed(2)}`;
}

/** Full precision, for order tickets and balances where the exact number matters. */
export function usdExact(amount: number): string {
  if (!isFinite(amount)) return "$0.00";
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Percent change. Two decimals, not one: on the compressed clock a Speedmaster's daily move
 * is ~0.4%, and toFixed(1) buries the quieter markets at 0.0%.
 */
export function pct(value: number): string {
  if (!isFinite(value)) return "0.00%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
