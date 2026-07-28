"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Icon, SocialIcon, type IconName } from "./Icons";
import { SOCIALS } from "@/lib/socials";

/**
 * Routes that render WITHOUT the app chrome. "/" is the public landing page — it has its own
 * nav and footer, and wrapping it in the trading rail would show a logged-out visitor a
 * dashboard frame before they have any reason to care about one.
 */
const BARE_ROUTES = new Set(["/", "/admin"]);

const NAV = [
  { href: "/trade", label: "Perpetuals" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/docs", label: "Docs" },
];

// Only routes that exist. The mockup's rail also had Orders, Referrals, Rewards and More —
// none of those are built, and a nav full of dead links is worse than a short honest one.
const RAIL: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Home", icon: "home" },
  { href: "/trade", label: "Perpetuals", icon: "chart" },
  { href: "/markets", label: "Markets", icon: "globe" },
  { href: "/portfolio", label: "Portfolio", icon: "wallet" },
  { href: "/leaderboard", label: "Leaderboard", icon: "trophy" },
  { href: "/profile", label: "Wallet", icon: "users" },
  { href: "/docs", label: "Docs", icon: "docs" },
];

const MOBILE_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Home", icon: "home" },
  { href: "/trade", label: "Trade", icon: "chart" },
  { href: "/markets", label: "Markets", icon: "globe" },
  { href: "/portfolio", label: "Portfolio", icon: "wallet" },
  { href: "/leaderboard", label: "Ranks", icon: "trophy" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, walletInstalled, wrongChain, chainName, switchChain, loginWithWallet, logout } = useAuth();

  // The landing page brings its own nav and footer. Hooks above still run, so this is a plain
  // early return and not a conditional-hook problem.
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <Link href="/" className="header-logo">
            <span>Watches</span>
            <span className="dot">Liquid</span>
          </Link>
          <nav className="header-nav">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="header-right">
          {/* Wrong-network is a state the Solana rail never had: a user can be connected but
              pointed at another chain, where deposits go somewhere nothing is watching. */}
          {wrongChain && (
            <button
              onClick={switchChain}
              className="btn btn-ghost"
              style={{ fontSize: 11, color: "var(--red)", borderColor: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="warning" size={13} /> Switch to {chainName}
            </button>
          )}

          <Link href="/markets" className="icon-btn" aria-label="Search markets">
            <Icon name="search" size={15} />
          </Link>

          {loading ? (
            <div className="skeleton" style={{ width: 130, height: 30 }} />
          ) : user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Link
                href="/profile"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 0, background: "var(--card)", fontSize: 12 }}
              >
                <div className="pulse" />
                <span className="mono" style={{ color: "var(--text)" }}>${Number(user.balanceUsd).toLocaleString()}</span>
              </Link>
              <Link
                href="/profile"
                className="mono"
                style={{ fontSize: 11, color: "var(--text-secondary)", padding: "5px 8px", background: "var(--card)", borderRadius: 0 }}
              >
                {user.publicKey ? `${user.publicKey.slice(0, 6)}..${user.publicKey.slice(-4)}` : user.id.slice(0, 6)}
              </Link>
              <button onClick={logout} className="btn btn-ghost" style={{ fontSize: 11 }}>Disconnect</button>
            </div>
          ) : (
            <button onClick={loginWithWallet} className="btn btn-primary" style={{ fontSize: 12 }}>
              {walletInstalled ? "Connect Wallet" : "Install a Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* NOT .main — TradeContent already uses that class for its chart/panel row, and nesting
          two would fight over flex direction. */}
      <div className="shell-body">
        <aside className="rail">
          <nav className="rail-menu">
            {RAIL.map((item) => (
              <Link key={item.href} href={item.href} className={`rail-item ${isActive(pathname, item.href) ? "active" : ""}`}>
                <Icon name={item.icon} size={16} />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="promo-card">
            <div className="promo-bolt"><Icon name="bolt" size={34} /></div>
            <div className="promo-title">
              Trade Luxury.<br />
              <span>Own Nothing.</span><br />
              <span>Profit Forever.</span>
            </div>
            <Link href="/docs" className="btn btn-ghost" style={{ width: "fit-content", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
              Learn More <Icon name="arrow-right" size={12} />
            </Link>
          </div>

          {/* Driven by lib/socials.ts. Previously four icons all pointed at /docs because the
              accounts did not exist; a link that goes nowhere reads as a broken site, so only
              real destinations are rendered now. */}
          <div className="rail-social">
            {SOCIALS.map((s) => (
              <a
                key={s.key}
                href={s.href}
                aria-label={s.label}
                title={s.label}
                {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {s.key === "x" ? <SocialIcon name="x" /> : <Icon name={s.key === "dex" ? "chart" : "docs"} size={15} />}
              </a>
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav">
        {MOBILE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""}>
            <span className="icon"><Icon name={item.icon} size={17} /></span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
