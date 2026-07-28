import Link from "next/link";

const SECTIONS = [
  { title: "What is Watches Liquid?", content: "Perpetual futures tied to luxury watch prices. Go LONG (price up) or SHORT (price down) on watch references without owning a physical watch. Virtual USD settlement." },
  { title: "How to Trade", content: "1. Connect your wallet\n2. Deposit USDG to fund your balance\n3. Pick a watch market\n4. Choose LONG or SHORT\n5. Set leverage (1x up to 50x, depending on the market)\n6. Enter size in USD\n7. Confirm\n\nReal-time P&L updates as prices move. Close anytime." },
  { title: "Fees", content: "Open Fee: 0.1% of notional\nClose Fee: 0.1% of notional\n\nExample: $100 at 5x = $500 notional. Open fee: $0.50. Close fee: $0.50.\n\nFees are charged on notional, so a round trip costs 0.2% of the position regardless of leverage." },
  { title: "Leverage", content: "Maximum leverage scales inversely with price and liquidity — thinner markets get less.\n\nUnder $10k (Speedmaster, Tank Must, BB58): 50x\n$10k–$20k (Submariner, Datejust): 40x\n$20k–$50k (Daytona, Pepsi, Royal Oak): 30x\n$50k–$120k (Day-Date, Zeitwerk, Nautilus): 20x\nOver $120k (RM 011): 10x" },
  { title: "Funding Rate", content: "Keeps the perp price anchored to the index. Payments every 8 hours. Rate capped at 0.1% per interval." },
  { title: "Liquidation", content: "Isolated margin — losses limited to position margin. Liquidation when margin ratio drops below 5% of collateral. Profit cap at 300% ROE.\n\nLONG: entryPrice × (1 - 0.95 / leverage)\nSHORT: entryPrice × (1 + 0.95 / leverage)" },
  {
    title: "Price Data",
    content:
      "Watches Liquid is powered by a market-simulation model designed to trade like the real luxury-watch market. To be clear up front: these are simulated prices, not live market quotes — no real watch has traded at these levels.\n\n" +
      "Each market is anchored to an approximate real-world value and moves as a mean-reverting model using that reference's own historical volatility, so a Daytona (~20%/yr) behaves differently from a Speedmaster (~7%/yr). The simulation runs on an accelerated clock where each ~30-second tick represents roughly one trading day — at real-world speed a luxury watch barely moves 0.02% per tick and every chart would sit flat.\n\n" +
      "Prices are smoothed with adaptive EWMA for a clean mark. A licensed live-data feed is already built into the architecture; until it's enabled, /api/admin/health always shows which source is active.",
  },
  { title: "Risks", content: "Trading with leverage carries real risk. You can lose your entire position margin, and higher leverage magnifies both gains and losses. Watches Liquid is experimental software provided as-is, and nothing here is financial advice. Please trade responsibly and only with funds you're comfortable putting at risk." },
];

// FAQ — trader-first, in the punchy style of pump.fun / Hyperliquid / GMX: short questions in
// the user's own words, short benefit-led answers, no engineering jargon. Two facts are kept
// legible on purpose because real money is involved: prices are simulated, and funds are
// custodial. Everything else is written to attract, not to lecture.
const FAQ = [
  {
    q: "What is Watches Liquid?",
    a: "Trade the world's finest watches like crypto. Go long or short on Rolex, Patek, AP and more with up to 50x leverage — no watch to store, no vault, no waiting. Just pure price action.",
  },
  {
    q: "How do I start?",
    a: "Connect your wallet and you're in — no sign-ups, no forms. Pick a watch, choose long or short, set your leverage, and confirm. You can be in your first trade in under a minute.",
  },
  {
    q: "What can I trade?",
    a: "20 of the most iconic references on earth — Daytona, Nautilus, Royal Oak, Speedmaster and more. Each is its own market with its own leverage and its own personality.",
  },
  {
    q: "How much leverage can I use?",
    a: "Up to 50x. The more liquid the watch, the higher you can go — the ultra-rare grails run at lower leverage to keep things fair. Higher leverage means bigger upside and faster liquidation, so size smart.",
  },
  {
    q: "What are the fees?",
    a: "Simple: 0.1% to open, 0.1% to close. That's a 0.2% round trip on your position size, no matter your leverage. No hidden spreads, no surprises.",
  },
  {
    q: "What do I trade with?",
    a: "USDG, the dollar stablecoin on Robinhood Chain. Deposit it to your account and it's credited 1:1, usually within a minute. Withdraw anytime and it goes straight back to your wallet — and we cover the network gas, not you.",
  },
  {
    q: "Do the prices track real watches?",
    a: "They're modelled on the real market — each watch is anchored to its actual July-2026 secondary-market value and moves with its own real volatility, so a Daytona and a Speedmaster don't trade alike. Time runs fast here: about every 30 seconds is a full trading day, so charts actually move. To be straight with you, these are simulated prices for the trading experience, not live quotes.",
  },
  {
    q: "What happens when I get liquidated?",
    a: "Every position is isolated, so you can never lose more than the margin you put into that trade — the rest of your account is always safe. If the price moves against you past your liquidation level, that position closes automatically. You can also set take-profit and stop-loss to stay in control.",
  },
  {
    q: "What's the funding rate?",
    a: "A small payment swapped between longs and shorts every 8 hours that keeps prices honest and the market balanced. If longs are crowded, longs pay shorts; if shorts are crowded, shorts pay longs. It's capped at 0.1% per interval.",
  },
  {
    q: "Is my money safe?",
    a: "Straight answer: Watches Liquid is custodial — we hold your USDG so trading can stay instant and gas-free, and your balance lives in our system. It's early, experimental software that hasn't been through a third-party audit yet, and there's no deposit insurance. Trade with confidence, but only with what you're comfortable putting at risk.",
  },
  {
    q: "Are you affiliated with Rolex, Patek, etc.?",
    a: "No. Watches Liquid is fully independent and not affiliated with, endorsed by, or sponsored by any watch brand. We use reference names only to identify each market, and all imagery is illustrative.",
  },
];

export default function DocsPage() {
  return (
    <div className="docs-page">
      <h1 className="docs-title">Documentation</h1>
      <p className="docs-subtitle">How Watches Liquid works</p>

      <div>
        {SECTIONS.map((s) => (
          <section key={s.title} className="docs-section">
            <h2>{s.title}</h2>
            <p>{s.content}</p>
          </section>
        ))}
      </div>

      <h2 className="docs-faq-title">Technical FAQ</h2>
      <div className="docs-faq">
        {FAQ.map((item, i) => (
          <details key={i} className="faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>

      <div className="docs-footer">
        <p>Watches Liquid — Experimental software. Not financial advice. Use at your own risk.</p>
        <p>Prices are simulated. Not affiliated with, endorsed by, or sponsored by any watch manufacturer. All brand and reference names are used descriptively to identify the underlying market.</p>
        <div className="btns">
          <Link href="/trade" className="btn btn-primary">Start Trading</Link>
          <Link href="/markets" className="btn btn-ghost">View Markets</Link>
        </div>
      </div>
    </div>
  );
}
