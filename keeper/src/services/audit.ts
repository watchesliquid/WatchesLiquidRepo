/**
 * Admin audit log + operational switches.
 *
 * Every admin action that changes state is recorded here before it takes effect. On a custodial
 * platform the audit log is what turns "money left the wallet" into "this admin moved this
 * amount to this address at this time" — without it, an incident is unreconstructable.
 *
 * The log is append-only by convention and has no delete route.
 *
 * The RAW entry is admin-only — it carries request IPs, full user ids and internal detail
 * blobs. A redacted projection is published at GET /api/transparency/audit-log so users can
 * watch admin activity without trusting a summary of it; see publicAuditEntry in
 * routes/transparency.ts, which allowlists per action rather than redacting per field.
 *
 * Consequence worth knowing when adding an action: whatever you put in `detail` is safe by
 * default (the projection ignores unknown actions), but if you then add a case for it, decide
 * field by field what belongs in public.
 */
import { memDb, saveDb } from "../db/memory";

export interface AuditEntry {
  id: string;
  time: string;
  admin: string;
  action: string;
  target?: string;
  /** Before/after for anything that mutates a value, so a change can be read at a glance. */
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown>;
  ip?: string;
}

export function audit(entry: Omit<AuditEntry, "id" | "time">): AuditEntry {
  const row: AuditEntry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    ...entry,
  };
  memDb.auditLog.push(row);
  // Written immediately rather than on the debounce: an action worth auditing is worth
  // surviving a crash that happens one line later.
  saveDb();
  console.log(`[audit] ${row.admin} ${row.action}${row.target ? " -> " + row.target : ""}`);
  return row;
}

// ── Operational switches ──
//
// Stored in memDb (and therefore persisted) rather than in module state, so a pause survives a
// restart. A kill switch that silently disengages when pm2 restarts the process is not a kill
// switch.

interface AdminState {
  id: string;
  withdrawalsPaused: boolean;
  pausedMarkets: string[];
  updatedAt: string;
  updatedBy: string;
}

function state(): AdminState {
  let s = memDb.adminState.find((r: any) => r.id === "global") as AdminState | undefined;
  if (!s) {
    s = {
      id: "global",
      withdrawalsPaused: false,
      pausedMarkets: [],
      updatedAt: new Date().toISOString(),
      updatedBy: "system",
    };
    memDb.adminState.push(s);
  }
  // Older persisted rows may predate a field; normalise so callers never see undefined.
  if (!Array.isArray(s.pausedMarkets)) s.pausedMarkets = [];
  return s;
}

export function getAdminState(): AdminState {
  return state();
}

export function areWithdrawalsPaused(): boolean {
  return state().withdrawalsPaused === true;
}

export function setWithdrawalsPaused(paused: boolean, by: string): void {
  const s = state();
  s.withdrawalsPaused = paused;
  s.updatedAt = new Date().toISOString();
  s.updatedBy = by;
  saveDb();
}

export function isMarketPaused(marketId: string): boolean {
  return state().pausedMarkets.includes(marketId);
}

export function setMarketPaused(marketId: string, paused: boolean, by: string): void {
  const s = state();
  const has = s.pausedMarkets.includes(marketId);
  if (paused && !has) s.pausedMarkets.push(marketId);
  if (!paused && has) s.pausedMarkets = s.pausedMarkets.filter((m) => m !== marketId);
  s.updatedAt = new Date().toISOString();
  s.updatedBy = by;
  saveDb();
}
