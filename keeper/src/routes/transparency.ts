/**
 * Public verifiability surface. No authentication, deliberately.
 *
 * This platform is custodial: one hot wallet holds every user's USDG, and balances are database
 * rows. No API route can move those funds or write a balance — the two that could were removed,
 * see routes/admin.ts — but the wallet key still lives on the server, so anyone with access to
 * the machine can. That is a real risk and SECURITY.md states it plainly.
 *
 * What this router adds is the ability to CHECK the claims rather than take them on trust:
 * solvency you can recompute from the chain, and an admin action log you can watch without
 * asking anyone's permission.
 *
 * Nothing here constrains an operator. Removing the routes did that; this makes what remains
 * observable.
 *
 * Design rule for everything below: publish figures and actions, never identities. The audit
 * projection is an explicit allowlist per action, so a newly added admin action publishes
 * nothing until someone deliberately decides what of it is safe to show.
 */
import { Router } from "express";
import { memDb } from "../db/memory";
import {
  getUsdgBalance,
  getGasBalance,
  getPlatformAddress,
  getChainConfig,
  isPlatformConfigured,
  isRpcConfigured,
  getBlockNumber,
} from "../services/evm";
import { computePnl, clampPnl } from "shared/margin";
import { activeSourceId, TICK_MS, TICK_DAYS } from "../services/price";
import type { Direction } from "shared/types";

export const transparencyRouter = Router();

// ── Proof of reserves ─────────────────────────────────────────────────────────

/**
 * Reserves are read from the chain, so this endpoint costs an RPC round trip. It is public and
 * the global limiter allows 600 req/min, which would happily turn into 600 RPC calls a minute.
 * Serve a short cache instead — the number moves on deposit/withdraw timescales, not per request.
 */
const RESERVES_TTL_MS = 30_000;
let reservesCache: { at: number; body: unknown } | null = null;

/**
 * What users could claim if every one of them exited right now.
 *
 * Deliberately conservative — it OVERSTATES the liability, so the coverage ratio it produces is
 * a floor rather than a flattering number:
 *   - unrealised profit counts as owed, at the current mark
 *   - the close fee every exit would actually pay is NOT subtracted
 *
 * Collateral is counted separately from wallet balance because opening a position moves money
 * out of `balance_usd` and into the position; counting only balances would understate what is
 * owed by the entire margin locked on the book.
 */
export function totalUserClaims(): {
  userBalances: number;
  openPositionCollateral: number;
  openPositionUnrealizedPnl: number;
  total: number;
  openPositions: number;
  users: number;
} {
  let userBalances = 0;
  for (const u of memDb.users as any[]) userBalances += Number(u.balance_usd) || 0;

  let openPositionCollateral = 0;
  let openPositionUnrealizedPnl = 0;
  let openPositions = 0;

  for (const p of memDb.positions as any[]) {
    if (p.status !== "open") continue;
    const market = memDb.markets.find((m: any) => m.id === p.market_id);
    if (!market) continue;

    const collateral = Number(p.collateral) || 0;
    const markPrice = Number(market.index_price);
    if (!isFinite(markPrice) || markPrice <= 0) continue;

    // clampPnl applies the same 300% cap and total-loss floor the close path uses, so this can
    // never claim more than a real exit would pay, nor less than zero.
    const pnl = clampPnl(
      computePnl(Number(p.entry_price), markPrice, Number(p.notional), p.direction as Direction),
      collateral,
    );

    openPositionCollateral += collateral;
    openPositionUnrealizedPnl += pnl;
    openPositions++;
  }

  return {
    userBalances,
    openPositionCollateral,
    openPositionUnrealizedPnl,
    total: userBalances + openPositionCollateral + openPositionUnrealizedPnl,
    openPositions,
    users: memDb.users.length,
  };
}

// GET /api/transparency/reserves
transparencyRouter.get("/reserves", async (_req, res) => {
  try {
    if (reservesCache && Date.now() - reservesCache.at < RESERVES_TTL_MS) {
      return res.json(reservesCache.body);
    }

    const cfg = getChainConfig();
    const claims = totalUserClaims();

    if (!isRpcConfigured() || !isPlatformConfigured()) {
      // Say so rather than reporting a zero balance, which would read as insolvency.
      return res.status(503).json({
        error: "Chain access is not configured on this instance; reserves cannot be verified here.",
        liabilities: claims,
      });
    }

    const platformAddress = getPlatformAddress();
    const [onChainUsdg, gasEth, blockNumber] = await Promise.all([
      getUsdgBalance(platformAddress),
      getGasBalance(platformAddress),
      getBlockNumber(),
    ]);

    const body = {
      asOf: new Date().toISOString(),
      chain: { chainId: cfg.chainId, name: cfg.name, blockNumber },

      // Published so this is independently checkable. Do not take our arithmetic for it —
      // read the balance yourself on the explorer.
      custodyWallet: {
        address: platformAddress,
        explorer: `${cfg.explorerUrl}/address/${platformAddress}`,
        usdgContract: cfg.usdgAddress,
      },

      assets: { onChainUsdg, gasEth },

      liabilities: {
        userBalances: claims.userBalances,
        openPositionCollateral: claims.openPositionCollateral,
        openPositionUnrealizedPnl: claims.openPositionUnrealizedPnl,
        total: claims.total,
        users: claims.users,
        openPositions: claims.openPositions,
      },

      // > 1 means the wallet holds more than users could claim. < 1 means it does not, and that
      // is worth knowing: funding is not zero-sum on a skewed book, so the house can run a
      // deficit. Reported either way rather than hidden.
      coverageRatio: claims.total > 0 ? onChainUsdg / claims.total : null,
      surplus: onChainUsdg - claims.total,

      method:
        "Liabilities are deliberately overstated: unrealised profit is counted as owed at the " +
        "current mark, and the close fee each exit would pay is not deducted. Coverage is " +
        "therefore a floor. Prices feeding unrealised PnL are simulated — see /api/transparency/oracle.",
      cacheSeconds: RESERVES_TTL_MS / 1000,
    };

    reservesCache = { at: Date.now(), body };
    res.json(body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public audit log ──────────────────────────────────────────────────────────

/** Shorten an identifier so actions stay correlatable without publishing who they belong to. */
function shorten(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Project an audit entry into what the public may see.
 *
 * An explicit allowlist per action, NOT a redaction pass over the stored row. The difference
 * matters: a redaction list has to be updated whenever a new field starts being audited, and
 * forgetting leaks it. This defaults to publishing only time/action/admin, so a new admin
 * action is silent here until someone decides what of it is safe.
 *
 * Never published: request IPs, full user ids, user wallet addresses, internal detail blobs.
 */
export function publicAuditEntry(row: any): Record<string, unknown> {
  const base: Record<string, unknown> = {
    time: row.time,
    action: row.action,
    // Truncated: enough to tell two admins apart and spot a compromised one acting oddly,
    // without handing out an address to phish. Admin keys never sign on-chain — the hot
    // wallet does — so the full address is not otherwise public.
    admin: shorten(row.admin),
  };

  switch (row.action) {
    // The one that matters most for rug detection: money leaving the custody wallet. The
    // destination is published IN FULL and unredacted, because it is already visible on-chain
    // and because "where did it go" is the entire point of watching this log.
    case "wallet.send":
      return {
        ...base,
        amountUsdg: Number(row.detail?.amount) || 0,
        to: row.target,
        reason: row.detail?.reason,
        status: row.detail?.status,
      };

    case "wallet.send.failed":
      return { ...base, failed: true };

    // Balance edits can create claims out of nothing, so the delta is published. The user is
    // truncated — the amount is the accountability signal, not who it landed on.
    case "user.balance.set":
      return {
        ...base,
        user: shorten(row.target),
        deltaUsd: Number(row.detail?.delta) || 0,
        reason: row.detail?.reason,
      };

    // Bounded by a transfer that actually arrived on-chain, so this cannot invent value. The
    // depositor's address is withheld — it is the user's wallet, not ours to publish.
    case "deposit.claim":
      return { ...base, user: shorten(row.target), amountUsdg: Number(row.detail?.amount) || 0 };

    // Support re-running the reconciler on one stuck withdrawal. The outcome is published so it
    // is visible whether a balance was restored, but NOT the txHash: unlike an admin treasury
    // send, that hash belongs to a user's own withdrawal and publishing it would expose the
    // wallet they withdrew to.
    case "withdrawal.recheck":
      return {
        ...base,
        user: shorten(row.target),
        outcome: row.detail?.outcome,
        amountUsdg: Number(row.detail?.amount) || 0,
      };

    case "withdrawals.pause":
    case "withdrawals.resume":
      return { ...base, withdrawalsPaused: Boolean(row.after) };

    case "market.pause":
    case "market.resume":
      return { ...base, market: row.target, paused: Boolean(row.after) };

    case "deposits.rescan":
      return { ...base };

    default:
      // Unknown action: publish the fact that it happened and nothing else.
      return base;
  }
}

// GET /api/transparency/audit-log?limit=100
transparencyRouter.get("/audit-log", (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100")) || 100, 1), 500);
  const rows = (memDb.auditLog as any[]).slice(-limit).reverse().map(publicAuditEntry);

  res.json({
    entries: rows,
    returned: rows.length,
    totalRecorded: memDb.auditLog.length,
    note:
      "Every state-changing admin action is recorded before it takes effect. Identities are " +
      "truncated and request IPs are never published; amounts and send destinations are not " +
      "redacted. This log lives in the same JSON database it describes — it is evidence for " +
      "users, not a tamper-proof ledger.",
  });
});

// ── Price provenance ──────────────────────────────────────────────────────────

// GET /api/transparency/oracle
transparencyRouter.get("/oracle", (_req, res) => {
  const source = activeSourceId();
  const simulated = source === "simulated";

  res.json({
    activeSource: source,
    simulated,
    disclosure: simulated
      ? "Prices on this platform are SIMULATED. They are generated by an internal model and do " +
        "not represent real transacted prices for these watches. Positions, PnL and liquidations " +
        "are computed against these simulated prices."
      : `Prices are sourced from ${source}.`,
    model: simulated
      ? {
          type: "Ornstein-Uhlenbeck in log-price",
          meanReverting: true,
          anchor:
            "Each market reverts to a fixed basePrice taken from WatchCharts secondary-market " +
            "values (July 2026). The anchor does not self-correct against the real market.",
          tickSeconds: TICK_MS / 1000,
          simulatedDaysPerTick: TICK_DAYS,
          note:
            "The clock is compressed: one tick advances the model by a simulated day, so prices " +
            "move far faster than real watch prices do.",
        }
      : null,
    realFeedStatus:
      "A real feed requires a licensed market-data source. WatchCharts blocks automated access " +
      "(HTTP 403), so this cannot be solved by scraping. The adapter seam exists at " +
      "keeper/src/services/price/watchcharts.ts and takes over automatically once a key is set.",
  });
});
