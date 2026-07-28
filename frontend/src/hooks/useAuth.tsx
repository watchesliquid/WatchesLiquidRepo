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

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const u = await api.getMe();
      setUser(u);
    } catch { localStorage.removeItem("token"); }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem("token");
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
      const result = await api.walletAuth(address, message, signature);
      localStorage.setItem("token", result.token);
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
