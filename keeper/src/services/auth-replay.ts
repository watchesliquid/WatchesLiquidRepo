/**
 * Single-use auth messages.
 *
 * POST /api/auth/wallet accepted any correctly-signed message whose timestamp was inside the
 * 5-minute window, as many times as it was presented. Anyone who obtained one signed message —
 * a proxy log, a shared machine, a browser extension, a client that retried over plain HTTP —
 * could mint a fresh 7-day token from it for the rest of that window. The signature proves the
 * key signed *something*; it does not prove this request came from the key holder.
 *
 * Recording each message on first use closes that. The message already carries the address, the
 * chain id and a timestamp (see buildAuthMessage), so it is unique per login attempt and needs
 * no format change — no frontend or wallet change is required.
 *
 * Two deliberate limits, both matching constraints the rest of the keeper already lives under:
 *
 *   - In-process, like the withdrawal nonce queue in evm.ts and the rate limiter. Correct only
 *     at ONE pm2 instance. At two, each would keep its own set and a message could be spent once
 *     per instance.
 *   - Cleared by a restart, which reopens a replay window of at most AUTH_WINDOW_MS. Persisting
 *     it would mean writing to the same JSON blob that holds user balances on every login, to
 *     defend a 5-minute window against an attacker who must already hold a captured signature
 *     AND have observed a restart. Not worth the write amplification.
 */

/** How long a signed auth message stays valid. Mirrors the check it replaced. */
export const AUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * How far ahead of our clock a message may be dated.
 *
 * The original check was `Date.now() - timestamp > WINDOW`, which is only an upper bound: a
 * timestamp in the future produced a negative difference and passed. A message dated a year out
 * was accepted for a year, and would have sat in the map below for just as long. Client clocks
 * genuinely drift, so allow a minute rather than requiring the timestamp be in the past.
 */
export const AUTH_FUTURE_SKEW_MS = 60 * 1000;

/**
 * Hard cap on retained messages, as a backstop to the 60s sweep and the 20-per-minute-per-IP
 * limiter already in front of /api/auth. Legitimate traffic cannot approach it.
 *
 * On overflow this REJECTS rather than evicting. Evicting the oldest entry would hand an
 * attacker the exploit back: flood the map, push a captured message out of it, then replay that
 * message. Failing closed costs a retry; failing open costs the account.
 */
const MAX_ENTRIES = 10_000;

/** message -> the time it stops being replayable (its timestamp + the window). */
const seen = new Map<string, number>();

/** Whether a message's timestamp is usable, or a reason it is not. */
export function checkAuthFreshness(timestamp: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Invalid auth message";
  if (now - timestamp > AUTH_WINDOW_MS) return "Auth message expired";
  if (timestamp - now > AUTH_FUTURE_SKEW_MS) return "Auth message is dated in the future";
  return null;
}

function prune(now: number): number {
  let removed = 0;
  for (const [message, expiry] of seen) {
    if (expiry <= now) {
      seen.delete(message);
      removed++;
    }
  }
  return removed;
}

/**
 * Claim a message. Returns false if it has already been used — the caller must then refuse the
 * login rather than issuing a token.
 *
 * Synchronous check-and-set on purpose: Node is single-threaded, so two concurrent replays that
 * both finished signature verification cannot both pass this. Do not add an `await` inside it,
 * for the same reason /positions/open must stay synchronous.
 *
 * Call this AFTER the signature verifies. Consuming first would let anyone burn a legitimate
 * user's in-flight message by posting it with a junk signature.
 */
export function consumeAuthMessage(
  message: string,
  timestamp: number,
  now: number = Date.now(),
): boolean {
  if (seen.has(message)) return false;

  if (seen.size >= MAX_ENTRIES) {
    prune(now);
    if (seen.size >= MAX_ENTRIES) {
      console.error(
        `[auth] replay store is full (${seen.size}); rejecting logins. This should be unreachable ` +
          "behind the /api/auth rate limit — check for a flood before raising the cap.",
      );
      return false;
    }
  }

  seen.set(message, timestamp + AUTH_WINDOW_MS);
  return true;
}

/** Retained message count. For tests and health output. */
export function authReplayStoreSize(): number {
  return seen.size;
}

// Sweep expired entries rather than doing it on every login. Same shape as rate-limit.ts.
// unref so it never holds the process open.
setInterval(() => prune(Date.now()), 60_000).unref?.();
