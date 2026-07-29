import { memDb, saveDb } from "../db/memory";
import { MAX_FUNDING_RATE, BASE_FUNDING_RATE, FUNDING_INTERVAL_MS } from "shared/constants";

/**
 * Settle funding on every market whose 8h interval has elapsed. Longs pay shorts when open
 * interest is long-skewed, and vice versa.
 *
 * Like risk-engine, this previously ran against Postgres while the rest of the app used memDb,
 * so it has never actually settled a payment.
 *
 * KNOWN GAP, needs a product decision rather than a patch. Flooring the debit at zero stops the
 * data-integrity damage, but it leaves an economic hole: a position held on the paying side by
 * an account with no spare balance now pays nothing at all, indefinitely, while the other side
 * keeps being credited. That is free leverage financing, and it is deliberately farmable.
 *
 * Closing it properly means one of:
 *   a) charging funding against the position's collateral — true isolated margin, and the
 *      position moves toward liquidation as it fails to fund. Correct, but it makes the
 *      `liquidation_price` stored at open (and published in the docs and UI) stale, so it needs
 *      a UI and docs change alongside.
 *   b) force-closing a position that cannot meet funding, which is a new close reason and a new
 *      thing to explain to users.
 *
 * Do not pick one of these silently. Until then, the shortfall is recorded on every payment row
 * and logged, so the cost is at least measurable.
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

      // A debit may not take a balance below zero.
      //
      // It used to. Funding is charged on NOTIONAL, so at 50x a $100 position owes $5 per
      // interval — and a user whose collateral is all in positions has a $0 wallet balance, so
      // the debit simply went negative and kept going. Three problems with that:
      //
      //   1. It walks past isolated margin, which promises losses stop at the collateral.
      //   2. The debt is uncollectable. Wallets are free, so the account is abandonable, while
      //      the other side of the trade was credited real, withdrawable USDG.
      //   3. It corrupted proof-of-reserves, where a negative balance SUBTRACTED from what the
      //      platform reported owing. (Also fixed, in transparency.ts.)
      //
      // Credits are untouched — funding is not zero-sum here by design and the house absorbs the
      // difference, which is the documented model.
      let applied = payment;
      let shortfall = 0;
      if (user && payment < 0) {
        const available = Math.max(0, Number(user.balance_usd));
        if (available < -payment) {
          applied = -available;
          shortfall = payment - applied; // negative: what could not be collected
        }
      }

      if (user) user.balance_usd = String(Number(user.balance_usd) + applied);

      if (shortfall < 0) {
        // Loud, because this is the platform eating a cost. A position that repeatedly cannot
        // fund itself is a position that should probably be closed — see the note below.
        console.warn(
          `[funding] shortfall ${shortfall.toFixed(4)} on position ${position.id} ` +
            `(user ${position.user_id}): owed ${payment.toFixed(4)}, collected ${applied.toFixed(4)}`,
        );
      }

      memDb.fundingPayments.push({
        id: crypto.randomUUID(),
        position_id: position.id,
        user_id: position.user_id,
        market_id: market.id,
        rate: String(fundingRate),
        payment: String(payment),
        applied: String(applied),
        shortfall: String(shortfall),
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
