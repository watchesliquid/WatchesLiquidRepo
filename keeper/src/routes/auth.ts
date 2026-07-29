import { Router } from "express";
import jwt from "jsonwebtoken";
import { memDb } from "../db/memory";
import { verifySignature, getChainConfig } from "../services/evm";
import { checkAuthFreshness, consumeAuthMessage } from "../services/auth-replay";
import { AUTH_PREFIX, normalizeAddress, isValidAddressFormat } from "shared/chain";
import { SIGNUP_BALANCE_USD } from "shared/constants";

/**
 * JWT signing secret. In production this MUST come from the environment.
 *
 * This used to be `process.env.JWT_SECRET ?? "dev-secret"`. Silently falling back to a constant
 * is the worst possible failure mode for this particular value, because forging a token is total
 * compromise rather than a single-account one: the payload is just `{ userId }`, and
 * requireAdmin resolves the admin from that userId. Anyone who knows the secret can mint an
 * admin session and call /admin/send. A fallback also fails at exactly the wrong moment — a
 * fresh box, a lost .env, a bad deploy — where nothing looks broken and every token is
 * forgeable by anyone who has read this file.
 *
 * Known-weak values are rejected too, because copying .env.example verbatim is the likeliest
 * way to end up "configured" with a published string.
 */
const WEAK_SECRETS = new Set([
  "dev-secret",
  "dev-secret-change-in-production",
  "change-me",
  "changeme",
  "secret",
]);

function resolveJwtSecret(): string {
  const fromEnv = (process.env.JWT_SECRET ?? "").trim();
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!fromEnv) {
      throw new Error(
        "JWT_SECRET is not set. Refusing to start in production — a default would let anyone " +
          "forge an admin session. Generate one with: openssl rand -hex 32",
      );
    }
    if (WEAK_SECRETS.has(fromEnv.toLowerCase())) {
      throw new Error(
        "JWT_SECRET is a known placeholder value. Refusing to start in production. " +
          "Generate a real one with: openssl rand -hex 32",
      );
    }
    if (fromEnv.length < 32) {
      throw new Error(
        `JWT_SECRET is only ${fromEnv.length} characters. Refusing to start in production — ` +
          "use at least 32. Generate one with: openssl rand -hex 32",
      );
    }
    return fromEnv;
  }

  // Development: keep `npm run dev` working with no setup, but say so every boot.
  if (!fromEnv || WEAK_SECRETS.has(fromEnv.toLowerCase())) {
    console.warn(
      "[auth] WARNING: using an insecure development JWT secret. Tokens are forgeable. " +
        "Set JWT_SECRET before deploying anywhere real.",
    );
    return "dev-secret-insecure-local-only";
  }
  return fromEnv;
}

const JWT_SECRET = resolveJwtSecret();

export const authRouter = Router();

function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * The session cookie.
 *
 * The token used to live only in localStorage, which means any script running on the page can
 * read it — one XSS anywhere in the app, or in a dependency, hands over a 7-day session. An
 * httpOnly cookie is not reachable from JavaScript at all, so the same XSS can still act as the
 * user while the page is open, but cannot walk away with a credential.
 *
 * Same-site works in both environments without special-casing: nginx serves the app and proxies
 * /api/ under one origin in production, and next.config.mjs rewrites /api to the keeper in
 * development. The browser only ever sees one origin, so SameSite=Strict is free — no
 * cross-site request carries this cookie, which is why adding CSRF tokens is not needed here.
 *
 * Secure is set outside development only because localhost is plain http; a Secure cookie there
 * would simply never be stored.
 */
const AUTH_COOKIE = "wl_session";
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60; // matches the JWT expiry

function setAuthCookie(res: any, token: string): void {
  const parts = [
    `${AUTH_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_S}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearAuthCookie(res: any): void {
  const parts = [`${AUTH_COOKIE}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Hand-rolled rather than pulling in cookie-parser. This is ~8 lines against a header format
 * that has not changed in twenty years, and every dependency is supply-chain surface on a box
 * holding a hot wallet key — the same reasoning as the rate limiter.
 */
function readCookie(req: any, name: string): string | null {
  const raw = req.headers?.cookie;
  if (typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function authMiddleware(req: any, res: any, next: any) {
  // Cookie first, Authorization header second. The header path is kept deliberately: tokens
  // issued before the cookie existed are still valid for their full 7 days, and the CLI scripts
  // (race-check, admin-check, mainnet-smoke) authenticate with a bearer token and have no
  // cookie jar. Removing it would break both.
  const header = req.headers.authorization;
  const token = readCookie(req, AUTH_COOKIE) ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);

  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// GET /api/auth/me
authRouter.get("/me", authMiddleware, (req: any, res) => {
  const user = memDb.users.find((u: any) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    id: user.id,
    email: user.email,
    publicKey: user.public_key ?? null,
    balanceUsd: Number(user.balance_usd),
    createdAt: user.created_at,
  });
});

// POST /api/auth/wallet — authenticate with wallet signature
authRouter.post("/wallet", async (req, res) => {
  try {
    const { publicKey, message, signature } = req.body;
    if (!publicKey || !message || !signature) {
      return res.status(400).json({ error: "publicKey, message, and signature required" });
    }

    if (!isValidAddressFormat(publicKey)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    // Normalise immediately. EIP-55 checksummed and lowercase are the same address but
    // different strings — every comparison below has to agree on one form.
    const address = normalizeAddress(publicKey);
    const { chainId } = getChainConfig();

    // Case-insensitive: wallets differ on whether eth_requestAccounts returns a checksummed
    // address, so the client may have signed either form.
    const expectedPrefix = `${AUTH_PREFIX}:${address}:${chainId}:`;
    if (!message.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
      return res.status(400).json({ error: "Invalid auth message" });
    }

    // Still lands on the timestamp — the message is single-line and ':'-delimited by design.
    const timestamp = parseInt(message.split(":").pop() ?? "0");
    const staleness = checkAuthFreshness(timestamp);
    if (staleness) return res.status(400).json({ error: staleness });

    const valid = await verifySignature(address, message, signature);
    if (!valid) return res.status(401).json({ error: "Invalid signature" });

    // Burn the message. A valid signature proves the key signed this string once; it does not
    // prove the request came from the key holder, so without this an intercepted message could
    // be redeemed for a fresh 7-day token repeatedly until its timestamp aged out.
    //
    // After verifySignature, never before: consuming first would let anyone invalidate a
    // legitimate user's in-flight login by replaying it with a junk signature.
    if (!consumeAuthMessage(message, timestamp)) {
      return res.status(401).json({ error: "Auth message already used. Please sign in again." });
    }

    // Lookup AND storage both use the normalised form. A case mismatch here would silently
    // create a second account for the same wallet, with its own fresh balance.
    let user = memDb.users.find((u: any) => normalizeAddress(u.public_key ?? "") === address);
    if (!user) {
      const id = crypto.randomUUID();
      user = {
        id,
        email: `${address.slice(0, 10)}@wallet`,
        password_hash: "",
        public_key: address,
        // 0, NOT a starting grant. Wallets are free and unlimited, so any signup credit is
        // withdrawable free money once the real rail is live. See SIGNUP_BALANCE_USD.
        balance_usd: String(SIGNUP_BALANCE_USD),
        created_at: new Date().toISOString(),
      };
      memDb.users.push(user);
    }

    const token = signToken(user.id);
    setAuthCookie(res, token);

    // Still returned in the body. The browser client no longer stores it — it relies on the
    // cookie — but the CLI scripts have no cookie jar and authenticate with a bearer token.
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        publicKey: user.public_key ?? null,
        balanceUsd: Number(user.balance_usd),
        createdAt: user.created_at,
      },
      token,
    });
  } catch {
    return res.status(500).json({ error: "Wallet auth failed" });
  }
});

// POST /api/auth/logout — clears the session cookie.
//
// Needed because the client cannot: an httpOnly cookie is not reachable from JavaScript, which
// is the whole point. Deliberately not authenticated — logging out with an already-expired or
// malformed token should still clear the cookie rather than 401 and leave it in place.
authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});
