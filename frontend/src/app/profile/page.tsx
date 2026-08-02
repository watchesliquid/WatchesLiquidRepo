"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isValidAddressFormat } from "shared/chain";

export default function ProfilePage() {
  const { user, loginWithWallet, walletInstalled, wrongChain, chainName, switchChain, logout, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState("");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: depositAddr } = useQuery({
    queryKey: ["deposit-address"],
    queryFn: () => api.getDepositAddress(),
    enabled: !!user,
    retry: false,
  });

  const { data: chainCheck } = useQuery({
    queryKey: ["deposit-check"],
    queryFn: () => api.checkDeposits(),
    enabled: !!user,
    refetchInterval: 30000,
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.withdraw(withdrawAddr, Number(withdrawAmt)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["deposit-check"] });
      setWithdrawAmt(""); setWithdrawAddr("");
    },
  });

  const copyAddress = () => {
    if (depositAddr?.address) {
      navigator.clipboard.writeText(depositAddr.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const addrValid = !withdrawAddr || isValidAddressFormat(withdrawAddr);

  if (!user) {
    return (
      <div className="page">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 380 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>⌚</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Connect Your Wallet</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              {walletInstalled
                ? `Connect an EVM wallet on ${chainName} to trade watch perps with USDG.`
                : 'Install MetaMask or another EVM wallet to get started.'}
            </div>
            <button onClick={loginWithWallet} className="btn btn-primary" style={{ width: '100%', padding: 14, fontSize: 14 }}>
              {walletInstalled ? 'Connect Wallet' : 'Install a Wallet'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Wallet</h1>
          <p className="page-subtitle">Deposit &amp; withdraw USDG on {chainName}</p>
        </div>
        <button onClick={logout} className="btn btn-ghost">Disconnect</button>
      </div>

      {wrongChain && (
        <div className="stat-card" style={{ marginBottom: 16, borderColor: 'var(--red)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>Wrong network</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            Your wallet is on another chain. Deposits sent from the wrong network will not be
            credited — nothing is watching that chain.
          </div>
          <button onClick={switchChain} className="btn btn-primary" style={{ fontSize: 12 }}>
            Switch to {chainName}
          </button>
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-card-label">Trading Balance</div>
          <div className="stat-card-value">${Number(user.balanceUsd).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Wallet USDG</div>
          <div className="stat-card-value" style={{ fontSize: 15 }}>
            {chainCheck?.walletBalance != null ? `$${chainCheck.walletBalance.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Wallet Address</div>
          <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
            {user.publicKey ? `${user.publicKey.slice(0, 8)}...${user.publicKey.slice(-6)}` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Network</div>
          <div className="stat-card-value" style={{ fontSize: 13, color: wrongChain ? 'var(--red)' : 'var(--green)' }}>
            {chainName}
          </div>
        </div>
      </div>

      {/* Display name — what appears on share cards and the leaderboard. Never the address. */}
      <div className="stat-card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Display Name</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Shown on the leaderboard and on shared PnL cards. Without one you appear as{' '}
          <span className="mono">{String(user.id).slice(0, 8)}</span>. Lowercase letters, numbers
          and underscores, 3–20 characters.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={username}
            onChange={(e) => { setUsername(e.target.value.toLowerCase()); setNameMsg(null); }}
            placeholder={user.username ?? 'yourname'}
            maxLength={20}
            type="text" className="size-input mono"
            style={{ flex: 1, minWidth: 180 }}
          />
          <button
            onClick={async () => {
              setNameMsg(null);
              try {
                await api.setUsername(username.trim());
                await refreshUser();
                setNameMsg({ ok: true, text: 'Display name saved' });
              } catch (err: any) {
                setNameMsg({ ok: false, text: err?.message ?? 'Could not save that name' });
              }
            }}
            disabled={username.trim().length < 3}
            className="btn btn-primary"
          >
            Save
          </button>
        </div>
        {nameMsg && (
          <div style={{ fontSize: 11, marginTop: 8, color: nameMsg.ok ? 'var(--green)' : 'var(--red)' }}>
            {nameMsg.text}
          </div>
        )}
      </div>

      {/* Deposit */}
      <div className="stat-card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Deposit USDG</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Send USDG to this address on {chainName}. Deposits are detected automatically within a
          minute. 1 USDG credits as $1.
        </div>

        {depositAddr ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{
                padding: '10px 14px', background: 'var(--bg)', borderRadius: 0,
                fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all', flex: 1, minWidth: 0
              }}>
                {depositAddr.address}
              </code>
              <button onClick={copyAddress} className="btn btn-primary" style={{ fontSize: 12, flexShrink: 0 }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
              USDG token: <span className="mono">{depositAddr.tokenAddress}</span>
            </div>
          </>
        ) : (
          <div className="text-muted" style={{ fontSize: 12 }}>
            Configure EVM_RPC_URL and PLATFORM_WALLET_KEY in keeper/.env to enable deposits.
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          Send USDG on {chainName} (chain ID {depositAddr?.chainId ?? '—'}) only. Sending any other
          token, or USDG on a different network, will not be credited. Deposits must come from your
          own connected wallet — transfers sent straight from an exchange cannot be attributed to you.
        </div>
      </div>

      {/* Withdraw */}
      <div className="stat-card">
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Withdraw USDG</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Send USDG from your trading balance to any address on {chainName}.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text" className="size-input" placeholder="Destination address (0x…)"
            value={withdrawAddr} onChange={(e) => setWithdrawAddr(e.target.value)}
            style={!addrValid ? { borderColor: 'var(--red)' } : undefined}
          />
          {!addrValid && (
            <div className="text-red" style={{ fontSize: 10 }}>Not a valid EVM address — expected 0x followed by 40 hex characters.</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" className="size-input" placeholder="Amount (USDG)"
              value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              onClick={() => withdrawMutation.mutate()}
              disabled={!withdrawAddr || !withdrawAmt || !addrValid || withdrawMutation.isPending}
              className="btn btn-danger"
              style={{ fontSize: 12, flexShrink: 0 }}
            >
              {withdrawMutation.isPending ? 'Sending...' : 'Withdraw'}
            </button>
          </div>
        </div>

        {withdrawMutation.isSuccess && withdrawMutation.data && (
          <div className="text-green" style={{ fontSize: 11, marginTop: 8 }}>
            Sent!{' '}
            <a href={withdrawMutation.data.explorerUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              {withdrawMutation.data.txHash.slice(0, 18)}…
            </a>
          </div>
        )}
        {withdrawMutation.isError && (
          <div className="text-red" style={{ fontSize: 11, marginTop: 8 }}>
            {(withdrawMutation.error as Error).message}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          Minimum 1 USDG.
        </div>
      </div>
    </div>
  );
}
