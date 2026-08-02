// ── Market & Trading Types ──

export type MarketCategory =
  | 'rolex' | 'patek' | 'ap' | 'omega'
  | 'cartier' | 'tudor' | 'grand-seiko' | 'haute';

export interface MarketConfig {
  id: string;
  name: string;
  category: MarketCategory;
  referenceNumber: string;
  brand: string;
  /** Display ticker, e.g. 'DAYTONA' -> rendered as DAYTONA-PERP. Explicit rather than derived:
   *  slicing it out of the id or name produces junk like "BLACK-PERP" for a Black Bay 58. */
  ticker: string;
  imageUrl: string;
  /** Long-run anchor price in USD. The simulator mean-reverts to this. */
  basePrice: number;
  /** Annualised volatility, e.g. 0.20 = 20%/yr. Drives both the live walk and seeded candles. */
  annualVol: number;
  maxLeverage: number;
  minPositionSize: number;
  feeRate: number;
}

export interface Market {
  marketId: string;
  name: string;
  category: MarketCategory;
  referenceNumber: string;
  brand: string;
  imageUrl: string;
  indexPrice: number;
  markPrice: number;
  change24h: number;
  volume24h: number;
  openInterestLong: number;
  openInterestShort: number;
  fundingRate: number;
  maxLeverage: number;
  minPositionSize: number;
  feeRate: number;
  isActive: boolean;
  oracleUpdatedAt: number;
  oracleConfidence: number;
}

export interface MarketStats {
  marketId: string;
  volume24h: number;
  trades24h: number;
  high24h: number;
  low24h: number;
  open24h: number;
}

export type Direction = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';
export type TradeType = 'open' | 'close' | 'liquidate';

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  direction: Direction;
  collateral: number;
  size: number;
  leverage: number;
  notional: number;
  entryPrice: number;
  liquidationPrice: number;
  markPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: PositionStatus;
  openedAt: number;
  closedAt: number | null;
  closePrice: number | null;
  pnl: number;
  unrealizedPnl: number;
  roe: number;
  marginRatio: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Trade {
  id: string;
  userId: string;
  marketId: string;
  positionId: string;
  type: TradeType;
  direction: Direction;
  size: number;
  leverage: number | null;
  price: number;
  fee: number;
  pnl: number;
  createdAt: number;
}

export interface FundingPayment {
  id: string;
  positionId: string;
  userId: string;
  marketId: string;
  rate: number;
  payment: number;
  paidAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  pnl: number;
  roi: number;
  winRate: number;
  tradeCount: number;
  topMarket: string;
}

// ── User & Auth Types ──

export interface User {
  id: string;
  email: string;
  /** Chosen display name, or null if never set. Lowercase, unique case-insensitively. */
  username?: string | null;
  /** What to render: the username when set, else a truncated-uuid pseudonym. Never the address. */
  displayName?: string;
  balanceUsd: number;
  createdAt: number;
}

export interface AuthResponse {
  user: User;
  token: string;
}

// ── API Types ──

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthResponse {
  ok: boolean;
  db: boolean;
  oracle: {
    /** Which PriceSource is actually serving quotes — "simulated" until a real feed is wired. */
    activeSource: string;
    primaryFailures: number;
    usingSecondary: boolean;
    marketsTracked: number;
    lastEwma: Record<string, number>;
  };
  timestamp: string;
}

export interface ProtocolStats {
  trades24h: number;
  volume24h: number;
  uniqueTraders: number;
  openPositions: number;
  openInterest: number;
  avgFundingRate: number;
  marketsTracked: number;
}

// ── Order Entry Types ──

export interface OpenPositionRequest {
  marketId: string;
  direction: Direction;
  size: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ClosePositionRequest {
  size?: number; // undefined = full close
}
