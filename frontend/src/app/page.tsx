"use client";

/**
 * Public landing page. Rendered WITHOUT the app chrome (see BARE_ROUTES in AppShell) — it has
 * its own nav and footer, because a logged-out visitor should meet a pitch, not a dashboard
 * frame for an account they don't have yet.
 *
 * The stats and ticker are live from the API rather than hardcoded marketing numbers: a landing
 * page that claims volume the app can't corroborate is the kind of thing people screenshot.
 * Everything falls back to a dash while loading, and to nothing if the API is down.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Icon, SocialIcon } from "@/components/Icons";
import { WatchImage } from "@/components/WatchImage";
import { ContractAddress } from "@/components/ContractAddress";
import { usd, pct } from "@/lib/format";
import { SOCIALS } from "@/lib/socials";
import { MAX_LEVERAGE, OPEN_FEE_RATE, CLOSE_FEE_RATE } from "shared/constants";
import "./landing.css";

const STEPS = [
  {
    n: "01",
    icon: "wallet" as const,
    title: "Connect & fund",
    body: "Connect any EVM wallet — no email, no KYC form, no waiting. Deposit USDG on Robinhood Chain and your balance is live in about a minute.",
  },
  {
    n: "02",
    icon: "globe" as const,
    title: "Pick a watch",
    body: "20 of the most iconic references on earth, each its own market. Daytona, Nautilus, Royal Oak, Speedmaster — every one with its own price action and leverage band.",
  },
  {
    n: "03",
    icon: "sliders" as const,
    title: "Size the trade",
    body: `Choose long or short, set leverage up to ${MAX_LEVERAGE}x, and confirm. Fills are instant at the mark price — no order book to fight, no slippage.`,
  },
];

export default function LandingPage() {
  const { data: marketsData } = useQuery({
    queryKey: ["landing-markets"],
    queryFn: () => api.getMarkets(),
    refetchInterval: 15_000,
  });
  const { data: stats } = useQuery({
    queryKey: ["landing-stats"],
    queryFn: () => api.getProtocolStats(),
    refetchInterval: 30_000,
  });

  const markets = marketsData?.markets ?? [];
  const ticker = markets.slice(0, 10);
  // Most-moved market drives the "Pick a Side" showcase — a flat market makes a poor advert.
  const featured =
    [...markets].sort((a: any, b: any) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0] ?? null;
  const roundTrip = ((OPEN_FEE_RATE + CLOSE_FEE_RATE) * 100).toFixed(2);

  return (
    <div className="lp">
      {/* ── Nav ── */}
      <header className="lp-nav">
        <Link href="/" className="lp-logo">
          <span>Watches</span>
          <span className="dot">Liquid</span>
        </Link>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#markets">Markets</a>
          <a href="#stats">Stats</a>
          <Link href="/docs">Docs</Link>
        </nav>
        <div className="lp-nav-cta">
          <a
            href="https://x.com/WatchesLiquid"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-icon-link"
            aria-label="Follow on X"
          >
            <SocialIcon name="x" size={16} />
          </a>
          <Link href="/trade" className="btn btn-primary lp-launch">
            Launch App <Icon name="arrow-up-right" size={13} />
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge">
            <span className="pulse" /> Live on Robinhood Chain
          </div>
          <h1>
            PERPS ON<br />
            THE WORLD&apos;S<br />
            <span>FINEST WATCHES.</span>
          </h1>
          <p>
            Long and short Rolex, Patek, AP and more with up to{" "}
            <span className="lev-highlight">{MAX_LEVERAGE}x leverage</span> — settled in USDG,
            no vault, no authentication, no waiting list.
          </p>
          <div className="lp-hero-btns">
            <Link href="/trade" className="btn btn-primary">
              Start trading <Icon name="arrow-right" size={14} />
            </Link>
            <Link href="/docs" className="btn btn-ghost">Read docs</Link>
          </div>

          <div className="lp-hero-meta">
            <div><strong>{stats ? stats.marketsTracked : "—"}</strong><span>Markets</span></div>
            <div><strong>{MAX_LEVERAGE}x</strong><span>Max leverage</span></div>
            <div><strong>{(OPEN_FEE_RATE * 100).toFixed(2)}%</strong><span>Flat fee</span></div>
            <div><strong>24/7</strong><span>Always open</span></div>
          </div>
        </div>
      </section>

      {/* ── Live ticker ── */}
      {ticker.length > 0 && (
        <div className="lp-ticker" id="markets">
          <div className="lp-ticker-track">
            {[...ticker, ...ticker].map((m: any, i: number) => {
              const up = (m.change24h ?? 0) >= 0;
              return (
                <div className="lp-ticker-item" key={`${m.marketId}-${i}`}>
                  <WatchImage marketId={m.marketId} size={22} />
                  <span className="tk">{m.ticker}</span>
                  <span className="pr">{usd(m.indexPrice ?? 0)}</span>
                  <span className={up ? "text-green" : "text-red"}>{pct(m.change24h ?? 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Pick a side ── */}
      <section className="lp-section lp-side">
        <div className="lp-side-copy">
          <span className="lp-eyebrow">Two directions</span>
          <h2>Pick a side.</h2>
          <p>
            Think the hype is over? Short it. Think the grail keeps climbing? Go long. Watches
            Liquid gives you both directions on assets that were previously buy-and-hold only —
            without ever taking delivery of a watch.
          </p>
          <ul className="lp-checklist">
            <li><Icon name="bolt" size={14} /> Instant fills at the mark — no order book, no slippage</li>
            <li><Icon name="shield" size={14} /> Isolated margin — risk is capped at each position</li>
            <li><Icon name="sliders" size={14} /> {roundTrip}% round trip, flat, whatever your leverage</li>
          </ul>
          <Link href="/markets" className="btn btn-accent-outline">
            Explore all markets <Icon name="arrow-right" size={12} />
          </Link>
        </div>

        <div className="lp-side-card">
          {featured ? (
            <>
              <div className="lp-card-head">
                <WatchImage marketId={featured.marketId} size={42} />
                <div>
                  <div className="nm">{featured.name}</div>
                  <div className="tk">{featured.ticker}-PERP</div>
                </div>
                <div className="pr">
                  <div className="v">{usd(featured.indexPrice ?? 0)}</div>
                  <div className={(featured.change24h ?? 0) >= 0 ? "text-green" : "text-red"}>
                    {pct(featured.change24h ?? 0)}
                  </div>
                </div>
              </div>
              <div className="lp-card-btns">
                <Link href={`/trade?market=${featured.marketId}`} className="lp-long">LONG</Link>
                <Link href={`/trade?market=${featured.marketId}`} className="lp-short">SHORT</Link>
              </div>
              <div className="lp-card-rows">
                <div><span>Max leverage</span><b>{featured.maxLeverage ?? MAX_LEVERAGE}x</b></div>
                <div><span>Open interest</span><b>{usd((featured.openInterestLong ?? 0) + (featured.openInterestShort ?? 0))}</b></div>
                <div><span>Funding</span><b>{((featured.fundingRate ?? 0) * 100).toFixed(4)}%</b></div>
              </div>
            </>
          ) : (
            <div className="skeleton" style={{ height: 260 }} />
          )}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="lp-section lp-how" id="how">
        <div className="lp-section-head">
          <span className="lp-eyebrow">How it works</span>
          <h2>Trading in three steps.</h2>
        </div>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div className="lp-step" key={s.n}>
              <div className="lp-step-top">
                <span className="lp-step-n">{s.n}</span>
                <span className="lp-step-icon"><Icon name={s.icon} size={18} /></span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="lp-section lp-stats" id="stats">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Live protocol stats</span>
          <h2>Numbers, straight from the engine.</h2>
        </div>
        <div className="lp-stat-grid">
          <div><strong>{stats ? usd(stats.volume24h) : "—"}</strong><span>24h volume</span></div>
          <div><strong>{stats ? usd(stats.openInterest) : "—"}</strong><span>Open interest</span></div>
          <div><strong>{stats ? stats.openPositions.toLocaleString() : "—"}</strong><span>Open positions</span></div>
          <div><strong>{stats ? stats.marketsTracked : "—"}</strong><span>Live markets</span></div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="lp-cta">
        <h2>DON&apos;T COLLECT THE WATCH.<br /><span>TRADE IT.</span></h2>
        <div className="lp-hero-btns">
          <Link href="/trade" className="btn btn-primary">
            Launch App <Icon name="arrow-up-right" size={14} />
          </Link>
          <Link href="/docs" className="btn btn-ghost">Read the docs</Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <Link href="/" className="lp-logo">
              <span>Watches</span>
              <span className="dot">Liquid</span>
            </Link>
            <p>Perpetual futures on the luxury watch market. Built on Robinhood Chain.</p>
            <div className="lp-footer-socials">
              {SOCIALS.map((s) => (
                <a
                  key={s.key}
                  href={s.href}
                  aria-label={s.label}
                  title={s.label}
                  {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {s.key === "x" ? <SocialIcon name="x" size={15} /> : <Icon name={s.key === "dex" ? "chart" : "docs"} size={15} />}
                  <span>{s.label}</span>
                </a>
              ))}
            </div>
            {/* The CA lives here rather than in the hero: people look for it when they are
                checking the project is what it says, and it is the one place a fake site cannot
                copy without pointing at a contract that fails verification on the explorer. */}
            <ContractAddress />
          </div>

          <div className="lp-footer-cols">
            <div>
              <h4>Protocol</h4>
              <Link href="/trade">Trade</Link>
              <Link href="/markets">Markets</Link>
              <Link href="/portfolio">Portfolio</Link>
              <Link href="/leaderboard">Leaderboard</Link>
            </div>
            <div>
              <h4>Resources</h4>
              <Link href="/docs">Documentation</Link>
              <Link href="/docs">FAQ</Link>
              <Link href="/docs">Fees &amp; leverage</Link>
            </div>
            <div>
              <h4>Community</h4>
              {SOCIALS.filter((s) => s.external).map((s) => (
                <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
              ))}
              <Link href="/docs">Contact</Link>
            </div>
          </div>
        </div>

        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} Watches Liquid</span>
          <span className="lp-chain">Robinhood Chain · USDG collateral</span>
        </div>
        <p className="lp-disclaimer">
          Experimental software · Not financial advice · Prices are simulated and not live market
          data · Trading with leverage carries risk and you can lose your entire position margin ·
          Not affiliated with, endorsed by, or sponsored by any watch manufacturer.
        </p>
      </footer>
    </div>
  );
}
