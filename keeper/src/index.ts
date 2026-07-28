import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { marketsRouter } from "./routes/markets";
import { positionsRouter } from "./routes/positions";
import { accountRouter } from "./routes/account";
import { leaderboardRouter } from "./routes/leaderboard";
import { adminRouter } from "./routes/admin";
import { seedMemMarkets, memDb, loadDb, startAutoSave, saveDb } from "./db/memory";
import { scrapeAllMarkets, buildCandles, seedHistoricalCandles, compute24hStats } from "./services/scraper";
import { runLiquidationCheck } from "./services/risk-engine";
import { settleFunding } from "./services/funding";
import { scanDeposits } from "./services/deposits";
import { getChainConfig, getPlatformAddress, isPlatformConfigured } from "./services/evm";
import { reconcilePendingWithdrawals } from "./services/withdrawals";
import { rateLimit } from "./middleware/rate-limit";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001");

// Env-driven: this gets compiled into the esbuild bundle, and a wrong value here fails every
// API call as a CORS error that reads like "the backend is down".
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
// Cap the body size. The default is 100kb, but nothing here needs more than a small JSON
// object and an unbounded body is free memory pressure on a single-instance server.
app.use(express.json({ limit: "32kb" }));

// nginx sets X-Forwarded-For; without this express reports the proxy IP for every client and
// the rate limiter would bucket the entire internet together.
app.set("trust proxy", 1);

// Rate limits, tightest on the paths that move money or mint accounts. There were none before
// enabling the real rail — auth is only a wallet signature, so an unthrottled /wallet endpoint
// lets one host enumerate accounts as fast as it can sign.
app.use("/api/auth", rateLimit(60_000, 20, "auth"));
app.use("/api/account/withdraw", rateLimit(60 * 60_000, 10, "wd"));
app.use("/api/account/deposit/check", rateLimit(60_000, 10, "dep"));
app.use("/api/positions", rateLimit(60_000, 120, "pos"));
app.use("/api", rateLimit(60_000, 600, "all"));

app.use("/api/auth", authRouter);
app.use("/api/markets", marketsRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/account", accountRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/admin", adminRouter);

// Restore persisted data (or seed fresh)
loadDb();
seedMemMarkets();
startAutoSave();
seedHistoricalCandles();

// Price scraper — every 30s
scrapeAllMarkets().catch(console.error);
setInterval(() => {
  scrapeAllMarkets().then(() => buildCandles()).then(() => compute24hStats()).catch(console.error);
}, 30000);

// Risk engine (liquidation, SL/TP, profit cap) — every 15s
setInterval(() => {
  runLiquidationCheck().catch(console.error);
}, 15000);

// Funding rate settlement — every 8h
settleFunding().catch(console.error);
setInterval(() => {
  settleFunding().catch(console.error);
}, 8 * 60 * 60 * 1000);

// Deposit scanner — every 60s. One eth_getLogs covers every user (the recipient is an indexed
// topic), versus the old per-user signature scan. Dedupe is per-user credited_txs of
// `${txHash}:${logIndex}`, and the block cursor lives in memDb.chainState so a restart resumes
// rather than skipping whatever arrived while we were down.
if (isPlatformConfigured()) {
  // Resolve withdrawals left `pending` by a crash BEFORE the deposit loop starts, so the
  // recovered balances are correct from the first tick rather than a minute in.
  reconcilePendingWithdrawals().catch((err) =>
    console.error("[withdrawals] boot reconcile failed:", err.message),
  );

  // 60s suits a shared public RPC. On a dedicated endpoint this can drop to ~15s, which is the
  // difference between a deposit landing "within a minute" and "in a few seconds". Tunable by env
  // so changing it does not need a rebuild. Floor of 5s: the scan is not reentrant, and a tick
  // faster than a scan takes would overlap itself.
  const SCAN_INTERVAL_MS = Math.max(5_000, parseInt(process.env.EVM_SCAN_INTERVAL_MS ?? "60000"));

  // A failed scan is safe: the cursor is only advanced after a successful pass, so the next tick
  // retries the same range. Deposits are delayed by an RPC error, never skipped.
  const tick = () =>
    scanDeposits().catch((err) => console.error("[deposits] scan failed:", err.message));
  setInterval(tick, SCAN_INTERVAL_MS);
  tick();
  console.log(`[deposits] scanning every ${SCAN_INTERVAL_MS / 1000}s`);
} else {
  console.warn("[deposits] PLATFORM_WALLET_KEY not configured — deposit scanning disabled");
}

app.listen(PORT, () => {
  const cfg = getChainConfig();
  console.log(`[keeper] Server running on http://localhost:${PORT}`);
  console.log(`[keeper] ${memDb.markets.length} markets loaded`);
  console.log(`[keeper] chain: ${cfg.name} (${cfg.chainId})  USDG ${cfg.usdgAddress}`);
  if (isPlatformConfigured()) console.log(`[keeper] platform wallet: ${getPlatformAddress()}`);
});
