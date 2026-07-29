"use client";

/**
 * Admin panel.
 *
 * Access is enforced by the SERVER (requireAdmin against ADMIN_ADDRESSES). Everything here is
 * just a client for that API — hiding a button in the UI is not a permission, so the panel never
 * assumes its own checks are the boundary. A non-admin who loads this page gets 403s from every
 * call, which is the intended outcome.
 *
 * Destructive actions require typing an exact confirmation phrase. That is aimed at operator
 * error, not at attackers: it cannot stop someone scripting against a stolen token.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { useAuth } from "@/hooks/useAuth";
import "./admin.css";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

async function adminFetch(path: string, options?: RequestInit) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API}/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const TABS = ["Overview", "Users", "Withdrawals", "Deposits", "Positions", "Markets", "Wallet", "Audit"] as const;
type Tab = (typeof TABS)[number];

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const ago = (t: string) => {
  const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("Overview");
  const qc = useQueryClient();
  const { user, loading: authLoading, walletInstalled, loginWithWallet } = useAuth();

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminFetch("/overview"),
    refetchInterval: 10_000,
    retry: false,
    // The panel renders without the app shell, so there is no global Connect button to fall
    // back on — don't fire admin calls until there is a session to authenticate them with.
    enabled: !!user,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-overview"] });

  if (authLoading) return <div className="adm-skel">Loading…</div>;

  // Signed out: this page is bare, so it has to offer its own way in.
  if (!user) {
    return (
      <div className="adm-gate">
        <h1>Admin</h1>
        <p>Connect an admin wallet to continue. Access is checked server-side against the allowlist.</p>
        <button className="btn btn-primary" onClick={loginWithWallet}>
          {walletInstalled ? "Connect Wallet" : "Install a Wallet"}
        </button>
        <Link href="/" className="btn btn-ghost">Back to site</Link>
      </div>
    );
  }

  // A 403 here means "authenticated, but not an admin" — say so plainly rather than rendering
  // an empty dashboard that looks like the platform has no data.
  if (overview.isError) {
    const msg = (overview.error as Error).message;
    const forbidden = msg.includes("Forbidden") || msg.includes("403");
    return (
      <div className="adm-gate">
        <h1>{forbidden ? "Not authorised" : "Admin unavailable"}</h1>
        <p>
          {forbidden
            ? "This wallet is not on the admin list. Add its address to ADMIN_ADDRESSES in keeper/.env on the server, then restart the API."
            : msg}
        </p>
        {forbidden && <code className="adm-addr">{user.publicKey ?? user.id}</code>}
        <Link href="/" className="btn btn-ghost">Back to site</Link>
      </div>
    );
  }

  const o = overview.data;

  return (
    <div className="adm">
      <header className="adm-top">
        <div className="adm-brand">
          <Link href="/">Watches<span>Liquid</span></Link>
          <span className="adm-tag">ADMIN</span>
        </div>
        <div className="adm-top-right">
          {o?.chain && (
            <span className={`adm-chip ${o.chain.isTestnet ? "warn" : "live"}`}>
              {o.chain.name} · {o.chain.chainId}
            </span>
          )}
          {o?.risk?.withdrawalsPaused && <span className="adm-chip danger">WITHDRAWALS PAUSED</span>}
        </div>
      </header>

      <nav className="adm-tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <main className="adm-body">
        {tab === "Overview" && <Overview o={o} loading={overview.isLoading} onChange={invalidate} />}
        {tab === "Users" && <Users />}
        {tab === "Withdrawals" && <Withdrawals paused={!!o?.risk?.withdrawalsPaused} onChange={invalidate} />}
        {tab === "Deposits" && <Deposits onChange={invalidate} />}
        {tab === "Positions" && <Positions />}
        {tab === "Markets" && <Markets />}
        {tab === "Wallet" && <Wallet o={o} />}
        {tab === "Audit" && <Audit />}
      </main>
    </div>
  );
}

/* ── Overview ── */
function Overview({ o, loading, onChange }: { o: any; loading: boolean; onChange: () => void }) {
  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      adminFetch("/withdrawals/pause", { method: "POST", body: JSON.stringify({ paused }) }),
    onSuccess: onChange,
  });

  if (loading || !o) return <div className="adm-skel">Loading…</div>;

  const solvent = o.solvency.surplus;

  return (
    <>
      {/* Solvency is the number that matters most on a custodial platform: can every user
          actually be paid out? Rendered as unknown, never as OK, when the RPC read failed. */}
      <section className={`adm-solvency ${solvent == null ? "" : solvent >= 0 ? "ok" : "bad"}`}>
        <div>
          <span className="lbl">User liabilities</span>
          <strong>{usd(o.solvency.userLiabilitiesUsd)}</strong>
        </div>
        <div>
          <span className="lbl">Wallet USDG</span>
          <strong>{o.solvency.walletUsdg == null ? "unreadable" : usd(o.solvency.walletUsdg)}</strong>
        </div>
        <div>
          <span className="lbl">Surplus</span>
          <strong>{solvent == null ? "unknown" : usd(solvent)}</strong>
        </div>
        <div className="adm-solvency-note">
          {solvent == null
            ? "Could not read the chain — solvency unverified."
            : solvent >= 0
              ? "Wallet covers all user balances."
              : "SHORTFALL — the wallet cannot cover all user balances."}
        </div>
      </section>

      <div className="adm-grid">
        <Stat label="Users" value={o.counts.users} />
        <Stat label="Open positions" value={o.counts.openPositions} />
        <Stat label="Trades (24h)" value={o.counts.trades24h} />
        <Stat label="Volume (24h)" value={usd(o.volume24h)} />
        <Stat label="Gas (ETH)" value={o.wallet.gasEth == null ? "—" : o.wallet.gasEth.toFixed(5)}
              warn={o.wallet.gasEth != null && o.wallet.gasEth < 0.0005} />
        <Stat label="Pending withdrawals" value={o.counts.pendingWithdrawals} warn={o.counts.pendingWithdrawals > 0} />
        <Stat label="Unattributed deposits" value={o.counts.unattributedDeposits} warn={o.counts.unattributedDeposits > 0} />
        <Stat label="Oracle" value={o.oracle.activeSource} />
      </div>

      <section className="adm-card">
        <h3>Withdrawal risk (rolling 24h)</h3>
        <Meter used={o.risk.globalWithdrawn24h} limit={o.risk.globalDailyLimit} label="Global daily limit" />
        <div className="adm-row-actions">
          <button
            className={o.risk.withdrawalsPaused ? "btn btn-primary" : "btn btn-danger"}
            onClick={() => pause.mutate(!o.risk.withdrawalsPaused)}
            disabled={pause.isPending}
          >
            {o.risk.withdrawalsPaused ? "Resume withdrawals" : "Pause withdrawals"}
          </button>
          <span className="adm-hint">
            Kill switch. Blocks all user withdrawals immediately and survives restarts.
          </span>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={`adm-stat ${warn ? "warn" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="adm-meter">
      <div className="adm-meter-head">
        <span>{label}</span>
        <span className="mono">{usd(used)} / {usd(limit)}</span>
      </div>
      <div className="adm-meter-bar"><div style={{ width: `${pctUsed}%` }} className={pctUsed > 80 ? "hot" : ""} /></div>
    </div>
  );
}

/* ── Users — read-only ──
   The "Set balance" control and its modal are gone with POST /admin/users/:id/balance. A
   balance edit is not bookkeeping once withdrawals are live; whatever was written there could
   be withdrawn as real USDG, which made this table a mint. See routes/admin.ts. */
function Users() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => adminFetch("/users"), refetchInterval: 15_000 });

  if (isLoading) return <div className="adm-skel">Loading…</div>;

  return (
    <div className="adm-tablewrap">
      <table className="adm-table">
        <thead>
          <tr><th>Address</th><th>Balance</th><th>Open</th><th>Margin</th><th>Deposits</th><th>Withdrawn 24h</th><th>Total out</th></tr>
        </thead>
        <tbody>
          {data.users.map((u: any) => (
            <tr key={u.id}>
              <td className="mono" title={u.address ?? ""}>{short(u.address)}</td>
              <td className="mono">{usd(u.balanceUsd)}</td>
              <td>{u.openPositions}</td>
              <td className="mono">{usd(u.marginInUse)}</td>
              <td>{u.depositsCredited}</td>
              <td className="mono">{usd(u.withdrawn24h)}</td>
              <td className="mono">{usd(u.withdrawnTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Withdrawals ── */
function Withdrawals({ paused, onChange }: { paused: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-withdrawals"], queryFn: () => adminFetch("/withdrawals"), refetchInterval: 15_000 });
  const pause = useMutation({
    mutationFn: (p: boolean) => adminFetch("/withdrawals/pause", { method: "POST", body: JSON.stringify({ paused: p }) }),
    onSuccess: onChange,
  });
  // Re-asks the chain about one stuck withdrawal. Support picks the row; the receipt decides the
  // result. There is nothing to fill in, because there is nothing for an operator to choose.
  const recheck = useMutation({
    mutationFn: (w: any) =>
      adminFetch("/withdrawals/recheck", { method: "POST", body: JSON.stringify({ userId: w.userId, txHash: w.txHash }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  if (isLoading) return <div className="adm-skel">Loading…</div>;

  return (
    <>
      <div className="adm-row-actions">
        <button className={paused ? "btn btn-primary" : "btn btn-danger"} onClick={() => pause.mutate(!paused)}>
          {paused ? "Resume withdrawals" : "Pause withdrawals"}
        </button>
      </div>
      <p className="adm-hint">
        Pending withdrawals are re-checked against the chain automatically every couple of
        minutes. &ldquo;Re-check&rdquo; just asks now instead of waiting — it cannot change the
        outcome, only read it.
      </p>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead><tr><th>When</th><th>User</th><th>To</th><th>Amount</th><th>Status</th><th>Tx</th><th></th></tr></thead>
          <tbody>
            {data.withdrawals.length === 0 && <tr><td colSpan={7} className="adm-empty">No withdrawals yet</td></tr>}
            {data.withdrawals.map((w: any, i: number) => (
              <tr key={i}>
                <td>{ago(w.time)}</td>
                <td className="mono">{short(w.address)}</td>
                <td className="mono">{short(w.to)}</td>
                <td className="mono">{usd(w.amount)}</td>
                <td><span className={`adm-badge ${w.status}`}>{w.status}</span></td>
                <td>{w.explorerUrl ? <a href={w.explorerUrl} target="_blank" rel="noopener noreferrer">{short(w.txHash)}</a> : "—"}</td>
                <td>
                  {w.status === "pending" && w.txHash && (
                    <button
                      className="btn btn-ghost sm"
                      disabled={recheck.isPending}
                      onClick={() => recheck.mutate(w)}
                    >
                      {recheck.isPending ? "Checking…" : "Re-check"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recheck.isError && <p className="adm-error">{(recheck.error as Error).message}</p>}
    </>
  );
}

/* ── Deposits ── */
function Deposits({ onChange }: { onChange: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-deposits"], queryFn: () => adminFetch("/deposits"), refetchInterval: 20_000 });
  const rescan = useMutation({
    mutationFn: () => adminFetch("/deposits/rescan", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-deposits"] }); onChange(); },
  });
  const [claiming, setClaiming] = useState<any>(null);
  if (isLoading) return <div className="adm-skel">Loading…</div>;

  return (
    <>
      <div className="adm-row-actions">
        <button className="btn btn-primary" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
          {rescan.isPending ? "Scanning…" : "Force deposit rescan"}
        </button>
        <span className="adm-hint">Deposits sent from an exchange can&apos;t be matched to a user automatically — claim them here.</span>
      </div>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead><tr><th>Seen</th><th>From</th><th>Amount</th><th>Tx</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.unattributed.length === 0 && <tr><td colSpan={6} className="adm-empty">No unattributed deposits</td></tr>}
            {data.unattributed.map((d: any) => (
              <tr key={d.key}>
                <td>{ago(d.observedAt)}</td>
                <td className="mono">{short(d.from)}</td>
                <td className="mono">{usd(d.amount)}</td>
                <td className="mono">{short(d.txHash)}</td>
                <td><span className={`adm-badge ${d.status === "unclaimed" ? "pending" : "confirmed"}`}>{d.status}</span></td>
                <td>{d.status === "unclaimed" && <button className="btn btn-ghost sm" onClick={() => setClaiming(d)}>Credit…</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {claiming && <ClaimModal dep={claiming} onClose={() => setClaiming(null)}
        onDone={() => { setClaiming(null); qc.invalidateQueries({ queryKey: ["admin-deposits"] }); }} />}
    </>
  );
}

function ClaimModal({ dep, onClose, onDone }: { dep: any; onClose: () => void; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ["admin-users"], queryFn: () => adminFetch("/users") });
  const [userId, setUserId] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({
    mutationFn: () =>
      adminFetch(`/deposits/${encodeURIComponent(dep.key)}/claim`, {
        method: "POST",
        body: JSON.stringify({ userId, confirm }),
      }),
    onSuccess: onDone,
  });
  return (
    <Modal title="Credit unattributed deposit" onClose={onClose}>
      <p className="adm-hint">
        The amount comes from the on-chain transfer, not from this form — you are choosing who it
        belongs to, not how much.
      </p>
      <Field label="Amount"><span className="mono">{usd(dep.amount)}</span></Field>
      <Field label="From"><span className="mono">{dep.from}</span></Field>
      <Field label="Credit to user">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Select a user…</option>
          {(data?.users ?? []).map((u: any) => (
            <option key={u.id} value={u.id}>{u.address ?? u.id} — {usd(u.balanceUsd)}</option>
          ))}
        </select>
      </Field>
      <Field label="Type CREDIT to confirm">
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="CREDIT" />
      </Field>
      {m.isError && <p className="adm-error">{(m.error as Error).message}</p>}
      <div className="adm-modal-btns">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!userId || confirm !== "CREDIT" || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Crediting…" : "Credit deposit"}
        </button>
      </div>
    </Modal>
  );
}

/* ── Positions ── */
function Positions() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-positions"], queryFn: () => adminFetch("/positions?status=open"), refetchInterval: 10_000 });
  if (isLoading) return <div className="adm-skel">Loading…</div>;
  return (
    <div className="adm-tablewrap">
      <table className="adm-table">
        <thead><tr><th>Market</th><th>Side</th><th>Collateral</th><th>Lev</th><th>Entry</th><th>Liq</th><th>PnL</th></tr></thead>
        <tbody>
          {data.positions.length === 0 && <tr><td colSpan={7} className="adm-empty">No open positions</td></tr>}
          {data.positions.map((p: any) => (
            <tr key={p.id}>
              <td>{p.marketId}</td>
              <td><span className={`adm-badge ${p.direction}`}>{p.direction}</span></td>
              <td className="mono">{usd(p.collateral)}</td>
              <td className="mono">{p.leverage}x</td>
              <td className="mono">{usd(p.entryPrice)}</td>
              <td className="mono">{usd(p.liquidationPrice)}</td>
              <td className={`mono ${p.pnl >= 0 ? "up" : "down"}`}>{usd(p.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Markets ── */
function Markets() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-markets"], queryFn: () => adminFetch("/markets"), refetchInterval: 15_000 });
  const toggle = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      adminFetch(`/markets/${id}/pause`, { method: "POST", body: JSON.stringify({ paused }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-markets"] }),
  });
  if (isLoading) return <div className="adm-skel">Loading…</div>;
  return (
    <>
      <p className="adm-hint">Pausing blocks new positions but still allows closing — never trap users in a position they can&apos;t exit.</p>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead><tr><th>Market</th><th>Price</th><th>Max lev</th><th>OI</th><th>State</th><th></th></tr></thead>
          <tbody>
            {data.markets.map((m: any) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="mono">{usd(m.indexPrice)}</td>
                <td className="mono">{m.maxLeverage}x</td>
                <td className="mono">{usd(m.openInterest)}</td>
                <td><span className={`adm-badge ${m.paused ? "pending" : "confirmed"}`}>{m.paused ? "halted" : "live"}</span></td>
                <td>
                  <button className="btn btn-ghost sm" onClick={() => toggle.mutate({ id: m.id, paused: !m.paused })}>
                    {m.paused ? "Resume" : "Halt"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Wallet ── */
function Wallet({ o }: { o: any }) {
  if (!o) return <div className="adm-skel">Loading…</div>;
  return (
    <>
      <div className="adm-grid">
        <Stat label="Platform address" value={short(o.wallet.address)} />
        <Stat label="USDG" value={o.wallet.usdg == null ? "unreadable" : usd(o.wallet.usdg)} />
        <Stat label="ETH (gas)" value={o.wallet.gasEth == null ? "—" : o.wallet.gasEth.toFixed(6)} warn={o.wallet.gasEth != null && o.wallet.gasEth < 0.0005} />
        <Stat label="Block" value={o.wallet.blockNumber ?? "—"} />
      </div>
      <section className="adm-card">
        <h3>Outbound transfers</h3>
        <p className="adm-hint">
          There is no send control here, and no API route behind one. The platform wallet pays out
          only through a user&apos;s own withdrawal. Moving funds any other way means a one-off
          script run on the server — deliberately not a button.
        </p>
      </section>
    </>
  );
}

/* ── Audit ── */
function Audit() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-audit"], queryFn: () => adminFetch("/audit"), refetchInterval: 15_000 });
  if (isLoading) return <div className="adm-skel">Loading…</div>;
  return (
    <div className="adm-tablewrap">
      <table className="adm-table">
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Change</th></tr></thead>
        <tbody>
          {data.entries.length === 0 && <tr><td colSpan={5} className="adm-empty">No admin actions recorded</td></tr>}
          {data.entries.map((e: any) => (
            <tr key={e.id}>
              <td title={e.time}>{ago(e.time)}</td>
              <td className="mono">{short(e.admin)}</td>
              <td><span className="adm-action">{e.action}</span></td>
              <td className="mono">{e.target ? short(e.target) : "—"}</td>
              <td className="mono adm-change">
                {e.before !== undefined && e.after !== undefined
                  ? `${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}`
                  : e.detail ? JSON.stringify(e.detail) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Shared bits ── */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="adm-modal-bg" onClick={onClose}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-head">
          <h3>{title}</h3>
          <button onClick={onClose} aria-label="Close"><Icon name="warning" size={0} /><span>✕</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
