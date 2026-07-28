import { memDb, saveDb } from "../db/memory";
import { MAX_FUNDING_RATE, BASE_FUNDING_RATE, FUNDING_INTERVAL_MS } from "shared/constants";

/**
 * Settle funding on every market whose 8h interval has elapsed. Longs pay shorts when open
 * interest is long-skewed, and vice versa.
 *
 * Like risk-engine, this previously ran against Postgres while the rest of the app used memDb,
 * so it has never actually settled a payment.
 */
export async function settleFunding(): Promise<{ payments: number }> {
  const now = Date.now();
  let paymentCount = 0;
  let dirty = false;

  for (const market of memDb.markets) {
    if (market.is_active === false) continue;

    const lastFunding = market.last_funding_time ? new Date(market.last_funding_time).getTime() : 0;
    if (lastFunding && now - lastFunding < FUNDING_INTERVAL_MS) continue;

    // First interval: stamp the clock and start counting from now rather than paying out
    // immediately on a market that has never funded.
    if (!lastFunding) {
      market.last_funding_time = new Date(now).toISOString();
      dirty = true;
      continue;
    }

    const oiLong = Number(market.open_interest_long) || 0;
    const oiShort = Number(market.open_interest_short) || 0;
    const total = oiLong + oiShort;

    // Skew in [-1, 1] scaled by the base rate, then clamped. Balanced or empty book => no skew,
    // so funding decays to the base rate rather than to zero.
    const skew = total > 0 ? (oiLong - oiShort) / total : 0;
    const raw = BASE_FUNDING_RATE + skew * BASE_FUNDING_RATE * 9;
    const fundingRate = Math.max(-MAX_FUNDING_RATE, Math.min(MAX_FUNDING_RATE, raw));

    const open = memDb.positions.filter(
      (p: any) => p.market_id === market.id && p.status === "open",
    );

    for (const position of open) {
      const base = Number(position.notional);
      // Longs pay when the rate is positive; shorts receive. Reversed when negative.
      const payment = (position.direction === "long" ? -1 : 1) * base * fundingRate;

      const user = memDb.users.find((u: any) => u.id === position.user_id);
      if (user) user.balance_usd = String(Number(user.balance_usd) + payment);

      memDb.fundingPayments.push({
        id: crypto.randomUUID(),
        position_id: position.id,
        user_id: position.user_id,
        market_id: market.id,
        rate: String(fundingRate),
        payment: String(payment),
        paid_at: new Date(now).toISOString(),
      });
      paymentCount++;
    }

    market.funding_rate = String(fundingRate);
    market.last_funding_time = new Date(now).toISOString();
    dirty = true;

    if (open.length > 0) {
      console.log(
        `[funding] ${market.id} rate=${(fundingRate * 100).toFixed(4)}% ` +
          `skew=${skew.toFixed(2)} positions=${open.length}`,
      );
    }
  }

  if (dirty) saveDb();
  return { payments: paymentCount };
}
