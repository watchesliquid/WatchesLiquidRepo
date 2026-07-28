/**
 * Admin API.
 *
 * Everything below /api/admin except /health requires BOTH a valid session (authMiddleware) and
 * an address listed in ADMIN_ADDRESSES (requireAdmin). Previously these routes were protected by
 * authMiddleware alone, which any logged-in user satisfies — /positions leaked every user's book.
 *
 * Money-moving routes (/send, /users/:id/balance) additionally require a typed confirmation and
 * are capped, rate-limited and audited. Those caps are a blast-radius limit, not a security
 * boundary: anyone holding a valid admin session can still move funds, which is inherent to the
 * feature. The audit log is what makes an incident reconstructable afterwards.
 */
import { Router } from "express";
import { memDb, saveDb } from "../db/memory";
import { authMiddleware } from "./auth";
import { requireAdmin, requireConfirmation, adminCount } from "../middleware/require-admin";
import { rateLimit } from "../middleware/rate-limit";
import { getEwmaSnapshot } from "../services/scraper";
import { activeSourceId } from "../services/price";
import {
  audit,
  getAdminState,
  setWithdrawalsPaused,
  setMarketPaused,
} from "../services/audit";
import { scanDeposits } from "../services/deposits";
import {
  getPlatformAddress,
  getUsdgBalance,
  getGasBalance,
  getBlockNumber,
  sendUsdg,
  isValidAddress,
  isPlatformConfigured,
  isRpcConfigured,
  getChainConfig,
} from "../services/evm";
import { normalizeAddress, txUrl } from "shared/chain";
import {
  WITHDRAW_DAILY_LIMIT_GLOBAL,
  WITHDRAW_DAILY_LIMIT_PER_USER,
  ADMIN_MAX_SEND,
  ADMIN_MAX_BALANCE_SET,
} from "shared/constants";

export const adminRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/admin/health — public (no sensitive data)
adminRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    db: true,
    oracle: {
      // The docs page claims prices are simulated; this is how that claim stays checkable
      // rather than drifting into the fiction the StockX copy became.
      activeSource: activeSourceId(),
      primaryFailures: 0,
      usingSecondary: false,
      marketsTracked: memDb.markets.filter((m: any) => m.is_active !== false).length,
      lastEwma: getEwmaSnapshot(),
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Everything below is admin-only ──
adminRouter.use(authMiddleware, requireAdmin);

/** Sum of withdrawals in the trailing 24h that moved (or may still move) funds. */
function withdrawn24h(user: any): number {
  const since = Date.now() - DAY_MS;
  return (user.withdrawals ?? [])
    .filter((w: any) => (w.status === "confirmed" || w.status === "pending") && new Date(w.time).getTime() >= since)
    .reduce((s: number, w: any) => s + Number(w.amount || 0), 0);
}

// GET /api/admin/overview — the dashboard's single call
adminRouter.get("/overview", async (_req: any, res) => {
  try {
    const cfg = getChainConfig();
    const platform = isPlatformConfigured() ? getPlatformAddress() : null;

    // Chain reads can fail (RPC down); the panel must still render the DB-derived half.
    let wallet: any = { configured: !!platform, address: platform };
    if (platform) {
      const [usdg, gas, block] = await Promise.allSettled([
        getUsdgBalance(platform),
        getGasBalance(platform),
        getBlockNumber(),
      ]);
      wallet = {
        configured: true,
        address: platform,
        usdg: usdg.status === "fulfilled" ? usdg.value : null,
        gasEth: gas.status === "fulfilled" ? gas.value : null,
        blockNumber: block.status === "fulfilled" ? block.value : null,
        rpcOk: usdg.status === "fulfilled",
      };
    }

    const users = memDb.users;
    const open = memDb.positions.filter((p: any) => p.status === "open");
    const since = Date.now() - DAY_MS;
    const trades24h = memDb.trades.filter((t: any) => new Date(t.created_at).getTime() >= since);

    // Total user balances vs USDG actually held: the single most important number on the page.
    // If liabilities exceed the wallet, the platform cannot honour every withdrawal.
    const liabilities = users.reduce((s: number, u: any) => s + Number(u.balance_usd || 0), 0);
    const globalWithdrawn = users.reduce((s: number, u: any) => s + withdrawn24h(u), 0);

    res.json({
      wallet,
      chain: { name: cfg.name, chainId: cfg.chainId, isTestnet: cfg.isTestnet, usdg: cfg.usdgAddress, rpcConfigured: isRpcConfigured() },
      oracle: { activeSource: activeSourceId(), marketsTracked: memDb.markets.length },
      counts: {
        users: users.length,
        openPositions: open.length,
        totalPositions: memDb.positions.length,
        trades24h: trades24h.length,
        totalTrades: memDb.trades.length,
        unattributedDeposits: memDb.unattributedDeposits.filter((d: any) => d.status === "unclaimed").length,
        pendingWithdrawals: users.reduce(
          (s: number, u: any) => s + (u.withdrawals ?? []).filter((w: any) => w.status === "pending").length, 0),
      },
      solvency: {
        userLiabilitiesUsd: liabilities,
        walletUsdg: wallet.usdg ?? null,
        // null when the RPC read failed — do NOT render a reassuring number we could not verify.
        surplus: wallet.usdg == null ? null : wallet.usdg - liabilities,
      },
      risk: {
        withdrawalsPaused: getAdminState().withdrawalsPaused,
        pausedMarkets: getAdminState().pausedMarkets,
        globalWithdrawn24h: globalWithdrawn,
        globalDailyLimit: WITHDRAW_DAILY_LIMIT_GLOBAL,
        perUserDailyLimit: WITHDRAW_DAILY_LIMIT_PER_USER,
      },
      adminCount: adminCount(),
      volume24h: trades24h.reduce((s: number, t: any) => s + Number(t.size || 0) * Number(t.leverage || 1), 0),
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
adminRouter.get("/users", (_req: any, res) => {
  const rows = memDb.users.map((u: any) => {
    const open = memDb.positions.filter((p: any) => p.user_id === u.id && p.status === "open");
    const ws = u.withdrawals ?? [];
    return {
      id: u.id,
      address: u.public_key ?? null,
      balanceUsd: Number(u.balance_usd || 0),
      openPositions: open.length,
      marginInUse: open.reduce((s: number, p: any) => s + Number(p.collateral || 0), 0),
      depositsCredited: (u.credited_txs ?? []).length,
      withdrawalCount: ws.length,
      withdrawnTotal: ws.filter((w: any) => w.status === "confirmed").reduce((s: number, w: any) => s + Number(w.amount || 0), 0),
      withdrawn24h: withdrawn24h(u),
      pendingWithdrawals: ws.filter((w: any) => w.status === "pending").length,
      createdAt: u.created_at,
    };
  });
  res.json({ users: rows.sort((a, b) => b.balanceUsd - a.balanceUsd) });
});

// GET /api/admin/positions
adminRouter.get("/positions", (req: any, res) => {
  const status = req.query.status as string | undefined;
  const all = memDb.positions
    .filter((p: any) => !status || p.status === status)
    .map((p: any) => ({
      id: p.id,
      userId: p.user_id,
      marketId: p.market_id,
      direction: p.direction,
      collateral: Number(p.collateral),
      leverage: p.leverage,
      entryPrice: Number(p.entry_price),
      liquidationPrice: Number(p.liquidation_price),
      status: p.status,
      pnl: Number(p.pnl ?? 0),
      createdAt: p.created_at,
    }));
  res.json({ positions: all.slice(-500).reverse() });
});

// GET /api/admin/trades
adminRouter.get("/trades", (req: any, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const rows = [...memDb.trades]
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((t: any) => ({
      id: t.id, userId: t.user_id, marketId: t.market_id, type: t.type,
      direction: t.direction, size: Number(t.size), leverage: t.leverage,
      price: Number(t.price), fee: Number(t.fee), pnl: Number(t.pnl), createdAt: t.created_at,
    }));
  res.json({ trades: rows });
});

// GET /api/admin/withdrawals — flattened across users, newest first
adminRouter.get("/withdrawals", (_req: any, res) => {
  const rows: any[] = [];
  for (const u of memDb.users as any[]) {
    for (const w of u.withdrawals ?? []) {
      rows.push({
        userId: u.id, address: u.public_key, to: w.to, amount: Number(w.amount),
        status: w.status, txHash: w.txHash ?? null, error: w.error ?? null, time: w.time,
        explorerUrl: w.txHash ? txUrl(getChainConfig(), w.txHash) : null,
      });
    }
  }
  rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  res.json({ withdrawals: rows.slice(0, 500) });
});

// GET /api/admin/deposits — unattributed (claimable) deposits
adminRouter.get("/deposits", (_req: any, res) => {
  res.json({
    unattributed: [...memDb.unattributedDeposits].reverse().slice(0, 200),
  });
});

// GET /api/admin/audit
adminRouter.get("/audit", (_req: any, res) => {
  res.json({ entries: [...memDb.auditLog].reverse().slice(0, 300) });
});

// GET /api/admin/markets
adminRouter.get("/markets", (_req: any, res) => {
  const paused = getAdminState().pausedMarkets;
  res.json({
    markets: memDb.markets.map((m: any) => ({
      id: m.id, name: m.name, indexPrice: Number(m.index_price),
      maxLeverage: m.max_leverage, isActive: m.is_active !== false,
      paused: paused.includes(m.id),
      openInterest: (Number(m.open_interest_long) || 0) + (Number(m.open_interest_short) || 0),
    })),
  });
});

// ── Operational controls ──

// POST /api/admin/withdrawals/pause  { paused: boolean }
adminRouter.post("/withdrawals/pause", (req: any, res) => {
  const paused = req.body?.paused === true;
  const before = getAdminState().withdrawalsPaused;
  setWithdrawalsPaused(paused, req.adminAddress);
  audit({ admin: req.adminAddress, action: paused ? "withdrawals.pause" : "withdrawals.resume", before, after: paused, ip: req.ip });
  res.json({ withdrawalsPaused: paused });
});

// POST /api/admin/markets/:id/pause  { paused: boolean }
adminRouter.post("/markets/:id/pause", (req: any, res) => {
  const id = req.params.id;
  if (!memDb.markets.some((m: any) => m.id === id)) return res.status(404).json({ error: "Market not found" });
  const paused = req.body?.paused === true;
  setMarketPaused(id, paused, req.adminAddress);
  audit({ admin: req.adminAddress, action: paused ? "market.pause" : "market.resume", target: id, after: paused, ip: req.ip });
  res.json({ marketId: id, paused });
});

// POST /api/admin/deposits/rescan
adminRouter.post("/deposits/rescan", rateLimit(60_000, 5, "adminrescan"), async (req: any, res) => {
  try {
    const result = await scanDeposits();
    audit({ admin: req.adminAddress, action: "deposits.rescan", detail: result as any, ip: req.ip });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/deposits/:key/claim  { userId, confirm }
// Credits an unattributed on-chain deposit to a user. Bounded by a transfer that actually
// arrived — the amount comes from the stored log, never from the request body.
adminRouter.post(
  "/deposits/:key/claim",
  requireConfirmation("CREDIT"),
  (req: any, res) => {
    const key = decodeURIComponent(req.params.key);
    const row = memDb.unattributedDeposits.find((d: any) => d.key === key);
    if (!row) return res.status(404).json({ error: "Deposit not found" });
    if (row.status !== "unclaimed") return res.status(409).json({ error: `Already ${row.status}` });

    const user = memDb.users.find((u: any) => u.id === req.body?.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Same dedupe key the scanner uses, so a claim can never double-credit a transfer that the
    // scanner later attributes on its own.
    if (!user.credited_txs) user.credited_txs = [];
    if (user.credited_txs.includes(key)) {
      row.status = "claimed";
      saveDb();
      return res.status(409).json({ error: "Already credited to this user" });
    }

    const before = Number(user.balance_usd);
    user.balance_usd = String(before + Number(row.amount));
    user.credited_txs.push(key);
    row.status = "claimed";
    row.claimedBy = user.id;
    row.claimedAt = new Date().toISOString();
    saveDb();

    audit({
      admin: req.adminAddress, action: "deposit.claim", target: user.id,
      before, after: Number(user.balance_usd),
      detail: { key, amount: row.amount, from: row.from }, ip: req.ip,
    });
    res.json({ ok: true, userId: user.id, amount: row.amount, newBalance: Number(user.balance_usd) });
  },
);

// ── Money-moving. Confirmed, capped, rate-limited, audited. ──

// POST /api/admin/users/:id/balance  { balance, reason, confirm }
adminRouter.post(
  "/users/:id/balance",
  rateLimit(60 * 60_000, 20, "adminbal"),
  requireConfirmation("SET BALANCE"),
  (req: any, res) => {
    const user = memDb.users.find((u: any) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const next = Number(req.body?.balance);
    if (!Number.isFinite(next) || next < 0) return res.status(400).json({ error: "balance must be a non-negative number" });
    // Once withdrawals are live a balance edit IS real money: whatever is set here can leave
    // through the normal withdrawal path. The cap bounds a fat-finger or a stolen session.
    if (next > ADMIN_MAX_BALANCE_SET) {
      return res.status(400).json({ error: `Balance cannot be set above ${ADMIN_MAX_BALANCE_SET} from the panel` });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 3) return res.status(400).json({ error: "A reason is required" });

    const before = Number(user.balance_usd);
    user.balance_usd = String(next);
    saveDb();

    audit({
      admin: req.adminAddress, action: "user.balance.set", target: user.id,
      before, after: next, detail: { reason, delta: next - before, address: user.public_key }, ip: req.ip,
    });
    res.json({ ok: true, userId: user.id, before, after: next });
  },
);

// POST /api/admin/send  { to, amount, reason, confirm }
adminRouter.post(
  "/send",
  rateLimit(60 * 60_000, 10, "adminsend"),
  requireConfirmation("SEND FUNDS"),
  async (req: any, res) => {
    try {
      if (!isPlatformConfigured()) return res.status(503).json({ error: "Platform wallet not configured" });

      const to = String(req.body?.to ?? "");
      const amount = Number(req.body?.amount);
      const reason = String(req.body?.reason ?? "").trim();

      if (!isValidAddress(to)) return res.status(400).json({ error: "Invalid destination address" });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be positive" });
      if (amount > ADMIN_MAX_SEND) return res.status(400).json({ error: `Single send is capped at ${ADMIN_MAX_SEND} USDG` });
      if (reason.length < 3) return res.status(400).json({ error: "A reason is required" });

      // Audit BEFORE broadcasting. If the process dies mid-send there must still be a record
      // that an outbound transfer was attempted, with the destination.
      const entry = audit({
        admin: req.adminAddress, action: "wallet.send", target: normalizeAddress(to),
        detail: { amount, reason, status: "attempting" }, ip: req.ip,
      });

      const result = await sendUsdg(to, amount);
      entry.detail = { ...(entry.detail as object), status: result.status, txHash: result.txHash };
      saveDb();

      if (result.status === "reverted") {
        return res.status(500).json({ error: "Transaction reverted on-chain", txHash: result.txHash });
      }
      res.json({ ok: true, txHash: result.txHash, explorerUrl: txUrl(getChainConfig(), result.txHash) });
    } catch (err: any) {
      audit({ admin: req.adminAddress, action: "wallet.send.failed", detail: { error: err.message }, ip: req.ip });
      res.status(500).json({ error: err.message });
    }
  },
);
