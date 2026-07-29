const BASE_URL = "/api";

/**
 * The session lives in an httpOnly cookie, not in localStorage.
 *
 * A token in localStorage is readable by any script on the page, so a single XSS — in our code
 * or in a dependency — walks off with a 7-day session. The cookie is unreachable from
 * JavaScript, so there is deliberately nothing to read here and nothing to attach by hand.
 *
 * `credentials: "include"` is what sends it. BASE_URL is a relative "/api", same-origin in both
 * environments (nginx in production, the next.config rewrite in development), so the cookie is
 * SameSite=Strict and no cross-site request can carry it.
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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

  // Clearing the session is a server round trip: the cookie is httpOnly, so the client cannot
  // delete it itself.
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

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
