/**
 * Dependency-free fixed-window rate limiter.
 *
 * Deliberately not express-rate-limit: the keeper ships as a single esbuild CJS bundle, this
 * needs ~30 lines, and every added dependency is supply-chain surface on a box that holds a
 * hot wallet key.
 *
 * In-process state, which is correct here only because the API runs at ONE pm2 instance
 * (the same constraint the withdrawal nonce queue already imposes). If that ever becomes
 * multiple instances, this silently allows N times the configured limit — move it to shared
 * storage at that point rather than raising the numbers.
 */
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Unbounded growth would be a slow memory leak with one entry per IP. Sweep expired buckets
// periodically rather than on every request.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60_000).unref?.();

/**
 * @param windowMs  window length
 * @param max       requests allowed per key per window
 * @param keyPrefix keeps separate limiters from colliding on the same IP
 */
export function rateLimit(windowMs: number, max: number, keyPrefix = "g") {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip, NOT the raw X-Forwarded-For header.
    //
    // This used to read `x-forwarded-for`.split(",")[0], on the belief that nginx sets the first
    // hop from the real client. It does the opposite: `$proxy_add_x_forwarded_for` APPENDS the
    // real address to whatever the client sent, so the header arrives as
    // "<whatever the caller typed>, <real ip>" and the first entry is attacker-controlled.
    //
    // Sending a different value per request therefore minted a fresh bucket every time and made
    // every limit here decorative — auth, the global cap, the admin rescan cap, all of it.
    //
    // express computes req.ip correctly from the RIGHT of that header, honouring the
    // `trust proxy` setting in index.ts, which was already configured properly. The manual parse
    // was overriding the thing that was right. Do not reintroduce it; if the proxy depth ever
    // changes, change `trust proxy`, not this.
    const key = `${keyPrefix}:${req.ip || "unknown"}`;

    const now = Date.now();
    const b = buckets.get(key);

    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    b.count++;
    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: `Too many requests. Retry in ${retryAfter}s.` });
    }
    next();
  };
}
