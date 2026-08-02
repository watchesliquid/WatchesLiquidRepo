"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import {
  isWalletInstalled,
  connectWallet,
  disconnectWallet,
  signAuthMessage,
  onAccountChange,
  onChainChange,
  isOnTargetChain,
  ensureChain,
  targetChain,
} from "@/lib/wallet";

interface User {
  id: string;
  email: string;
  publicKey: string | null;
  /** Chosen display name, or null if never set. */
  username?: string | null;
  /** What to render: the username when set, else a truncated-uuid pseudonym. Never the address. */
  displayName?: string;
  balanceUsd: number;
  createdAt: number;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  walletInstalled: boolean;
  wrongChain: boolean;
  chainName: string;
  refreshUser: () => Promise<void>;
  loginWithWallet: () => Promise<void>;
  switchChain: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletInstalled, setWalletInstalled] = useState(false);
  const [wrongChain, setWrongChain] = useState(false);

  // The session is an httpOnly cookie, so there is no token to look for before asking. Just ask:
  // /auth/me answers from the cookie the browser attaches, and a 401 means no session. Checking
  // localStorage first was only ever a way to skip a request, and it is the thing we removed.
  const refreshUser = useCallback(async () => {
    try {
      const u = await api.getMe();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  // The server has to clear the cookie — JavaScript cannot touch an httpOnly one, which is the
  // point of it. Local state is cleared regardless, so a failed request still logs you out here.
  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    setUser(null);
    try { await disconnectWallet(); } catch {}
  }, []);

  useEffect(() => {
    // Deferred to an effect: the provider is injected by an extension and may not exist during
    // SSR or the first client render.
    setWalletInstalled(isWalletInstalled());
    refreshUser().finally(() => setLoading(false));
    isOnTargetChain().then((ok) => setWrongChain(isWalletInstalled() && !ok));

    // accountsChanged hands back an ARRAY; empty means the user disconnected in the wallet.
    const offAccount = onAccountChange((address) => { if (!address) logout(); else refreshUser(); });
    const offChain = onChainChange((_id, onTarget) => setWrongChain(!onTarget));
    return () => { offAccount(); offChain(); };
  }, [refreshUser, logout]);

  const loginWithWallet = useCallback(async () => {
    if (!isWalletInstalled()) return;
    try {
      const address = await connectWallet(); // also switches/adds the chain
      const { message, signature } = await signAuthMessage(address);
      // No token stored: /auth/wallet sets the httpOnly cookie on the response.
      const result = await api.walletAuth(address, message, signature);
      setUser(result.user);
      setWrongChain(false);
    } catch (err: any) {
      // 4001 = user rejected in the wallet; not an error worth logging.
      if (err?.code !== 4001 && err?.message !== "User rejected the request") {
        console.error("Wallet auth failed:", err);
      }
    }
  }, []);

  const switchChain = useCallback(async () => {
    try {
      await ensureChain();
      setWrongChain(false);
    } catch (err) {
      console.error("Chain switch failed:", err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, loading, walletInstalled, wrongChain,
        chainName: targetChain().name,
        refreshUser, loginWithWallet, switchChain, logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
