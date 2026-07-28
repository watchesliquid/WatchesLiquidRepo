const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }

  return json;
}

export const api = {
  // Auth (wallet only)
  walletAuth: (publicKey: string, message: string, signature: string) =>
    request<{ user: any; token: string }>("/auth/wallet", {
      method: "POST",
      body: JSON.stringify({ publicKey, message, signature }),
    }),

  getMe: () => request<any>("/auth/me"),

  // Markets
  getMarkets: () => request<{ markets: any[] }>("/markets"),

  getMarket: (id: string) => request<any>(`/markets/${id}`),

  // The route reads `resolution` and `limit` (max 500) — it has never read from/to, which is
  // what this used to send, so those params were silently discarded on every call.
  getCandles: (marketId: string, resolution: string, limit?: number) => {
    const params = new URLSearchParams({ resolution });
    if (limit) params.set("limit", String(limit));
    return request<{ candles: any[] }>(`/markets/${marketId}/candles?${params}`);
  },

  // Positions
  getPositions: () => request<{ positions: any[] }>("/positions"),

  openPosition: (body: {
    marketId: string;
    direction: string;
    size: number;
    leverage: number;
    stopLoss?: number;
    takeProfit?: number;
  }) =>
    request<any>("/positions/open", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  closePosition: (id: string, size?: number) =>
    request<any>(`/positions/${id}/close`, {
      method: "POST",
      body: JSON.stringify({ size }),
    }),

  updateSlTp: (id: string, stopLoss?: number | null, takeProfit?: number | null) =>
    request<any>(`/positions/${id}/sl-tp`, {
      method: "POST",
      body: JSON.stringify({ stopLoss, takeProfit }),
    }),

  getProtocolStats: () =>
    request<{
      trades24h: number; volume24h: number; uniqueTraders: number;
      openPositions: number; openInterest: number; avgFundingRate: number; marketsTracked: number;
    }>("/markets/stats"),

  // Account
  getBalance: () => request<{ balance: number }>("/account/balance"),

  getDepositAddress: () =>
    request<{ address: string; network: string; chainId: number; token: string; tokenAddress: string }>(
      "/account/deposit-address",
    ),

  checkDeposits: () =>
    request<{ walletBalance: number; internalBalance: number; credited: number; message: string }>(
      "/account/deposit/check",
      { method: "POST" },
    ),

  withdraw: (toAddress: string, amount: number) =>
    request<{ txHash: string; explorerUrl: string; newBalance: number }>("/account/withdraw", {
      method: "POST",
      body: JSON.stringify({ toAddress, amount }),
    }),

  getTradeHistory: (limit = 50, offset = 0) =>
    request<{ trades: any[]; total: number }>(`/account/trades?limit=${limit}&offset=${offset}`),

  // Leaderboard
  getLeaderboard: (period = "7d", limit = 50) =>
    request<{ entries: any[] }>(`/leaderboard?period=${period}&limit=${limit}`),

  // Health
  getHealth: () => request<any>("/admin/health"),
};
