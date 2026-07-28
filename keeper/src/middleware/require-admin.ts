/**
 * Admin authorisation.
 *
 * Before this existed, every route under /api/admin used the plain `authMiddleware`, which only
 * verifies that a JWT is valid — it does not say WHOSE. Any logged-in user could therefore read
 * /api/admin/positions and see every other user's book. There was no admin concept at all.
 *
 * Admins are identified by wallet address, listed in ADMIN_ADDRESSES in keeper/.env:
 *
 *   ADMIN_ADDRESSES=0xabc...,0xdef...
 *
 * Why the env file and not a DB flag: keeper/.env is chmod 600 on the box and is not writable by
 * the application, so no route, no injection and no corrupted DB write can promote an account to
 * admin. Granting admin requires filesystem access to the server.
 *
 * Why wallet address and not a password: the platform has no passwords. Admins already prove
 * control of an address by signature at login, so this reuses a stronger primitive than any
 * password we would have to store.
 *
 * FAIL CLOSED: an unset or empty ADMIN_ADDRESSES denies everyone. An admin panel that opens up
 * because a config line went missing is worse than one that locks its owner out.
 */
import type { Request, Response, NextFunction } from "express";
import { memDb } from "../db/memory";
import { normalizeAddress } from "shared/chain";

function adminAddresses(): string[] {
  return (process.env.ADMIN_ADDRESSES ?? "")
    .split(",")
    .map((a) => normalizeAddress(a))
    .filter((a) => a.length > 0);
}

export function isAdminAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return adminAddresses().includes(normalizeAddress(address));
}

export function adminCount(): number {
  return adminAddresses().length;
}

/** Runs AFTER authMiddleware, so req.userId is already populated and verified. */
export function requireAdmin(req: any, res: Response, next: NextFunction) {
  const user = memDb.users.find((u: any) => u.id === req.userId);
  if (!user || !isAdminAddress(user.public_key)) {
    // Deliberately identical to a missing-route response shape and logged server-side only:
    // confirming "this endpoint exists but you are not an admin" tells a prober what to target.
    console.warn(`[admin] denied: user=${req.userId} addr=${user?.public_key ?? "none"}`);
    return res.status(403).json({ error: "Forbidden" });
  }
  req.adminAddress = normalizeAddress(user.public_key);
  next();
}

/**
 * Extra gate for irreversible, money-moving operations.
 *
 * The client must echo an exact confirmation phrase in the body. This does not stop an attacker
 * who is scripting against a stolen token — nothing at this layer can — but it does stop the
 * far more common failure: an operator clicking the wrong button on the wrong row at 2am.
 */
export function requireConfirmation(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.confirm !== expected) {
      return res.status(400).json({
        error: `This action requires confirmation. Send { "confirm": "${expected}" }.`,
      });
    }
    next();
  };
}
