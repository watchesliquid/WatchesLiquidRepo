// ── Trading Parameters ──

export const MAX_LEVERAGE = 50;
export const MIN_POSITION_SIZE_USD = 1;
export const MAX_POSITIONS_PER_USER = 5;
export const PROFIT_CAP_ROE = 3.0; // 300%

// Fees are charged on NOTIONAL (size × leverage), so PnL and fees scale together and
// break-even is 2 × feeRate regardless of leverage — 0.2% here. The other half matters
// too: round-trip fee as a share of collateral is 2 × leverage × feeRate, so at the old
// 2% rate a 25x round trip cost 100% of collateral and anything above ~49x could not be
// opened at all (requiredMargin = size + fee exceeded the position). 0.1% is in line with
// real perps (Hyperliquid ~0.025%, GMX ~0.05%).
export const OPEN_FEE_RATE = 0.001; // 0.1% of notional
export const CLOSE_FEE_RATE = 0.001; // 0.1% of notional
export const PROTOCOL_REVENUE_SHARE = 0.25; // 25% to protocol
export const LP_FEE_SHARE = 0.75; // 75% to LPs

// 5% of COLLATERAL (initial margin), not of notional. This is what makes
// liqPrice = entry × (1 - 0.95/leverage) come out, which is the formula the UI shows and the
// docs publish. A notional-based rule at this value would cap usable leverage at 1/0.05 = 20x
// and instantly liquidate every position in the 12 markets above that. See shared/src/margin.ts.
export const MAINTENANCE_MARGIN_RATIO = 0.05;
export const LIQUIDATION_FEE = 0.0125; // 1.25% of notional, keeper incentive

// ── Funding Rate ──

export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const MAX_FUNDING_RATE = 0.001; // 0.1% per interval
export const BASE_FUNDING_RATE = 0.0001; // 0.01% base rate

// ── Oracle / Price Feed ──

export const ORACLE_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const EWMA_BASE_ALPHA = 0.2;
export const EWMA_HIGH_ALPHA = 0.5;
export const EWMA_DEVIATION_THRESHOLD = 0.05; // 5% deviation triggers high alpha
export const ORACLE_STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min = stale

// ── Candle Resolutions ──

export const CANDLE_RESOLUTIONS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type CandleResolution = (typeof CANDLE_RESOLUTIONS)[number];

export const CANDLE_RESOLUTION_MS: Record<CandleResolution, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// ── Polling Intervals (Frontend) ──

export const POLL_MARKETS_MS = 5000;
export const POLL_MARKET_MS = 2000;
export const POLL_POSITIONS_MS = 5000;
export const POLL_LEADERBOARD_MS = 30000;

// ── Account funding ──

/**
 * Balance granted on signup. MUST STAY 0 while withdrawals are enabled.
 *
 * This was 10000 when balances were play money. With a real withdrawal rail that is a free
 * money faucet: wallets are free and unlimited, auth is just a signature, so anyone could
 * connect a fresh wallet, receive $10,000 and withdraw it as real USDG, repeating until the
 * platform hot wallet is empty. Balance now comes only from confirmed on-chain deposits.
 */
export const SIGNUP_BALANCE_USD = 0;

// ── Withdrawal risk limits ──
//
// Blast-radius caps for a custodial hot wallet. None of these prevent a determined attacker
// who has found a real balance bug, but they bound how much leaves before a human notices.

/** Max a single user can withdraw per rolling 24h. */
export const WITHDRAW_DAILY_LIMIT_PER_USER = 5000;
/** Max the platform will send in total per rolling 24h — the circuit breaker. */
export const WITHDRAW_DAILY_LIMIT_GLOBAL = 25000;
/** Largest single withdrawal permitted without manual review. */
export const WITHDRAW_MAX_SINGLE = 2500;

// ── Admin panel blast-radius caps ──
//
// These bound what a single admin request can do. They are NOT a security boundary — anyone
// holding a valid admin session can repeat a request — but they turn "one click empties the
// wallet" into "one click moves at most this much", and they catch fat-fingered amounts.
// Raise them deliberately; a bigger number here is a bigger worst case.

/** Max USDG a single admin /send may move. */
export const ADMIN_MAX_SEND = 5000;
/** Ceiling on a manually set user balance. */
export const ADMIN_MAX_BALANCE_SET = 100000;
