"use client";

import { useState } from "react";
import { getMarketById } from "shared/markets";
import type { MarketCategory } from "shared/types";

// Cache-buster. The first image deploy sent `Cache-Control: immutable`, so browsers that loaded
// then hold the white-background versions and will NEVER re-fetch the same URL, no matter what
// the server now sends. Bumping this changes the URL, which abandons the old cache entry.
// Increment whenever the image FILES change in place.
const IMG_VERSION = 6;

/**
 * Keyed by category, not market id. The old per-market map was 90% redundant — every aj1-*
 * entry carried the same colour, which is just the category restated 5 times.
 */
const BRAND_STYLE: Record<MarketCategory, { bezel: string; dial: string; fg: string }> = {
  'rolex':       { bezel: '#006039', dial: '#1a1a1a', fg: '#D4AF37' },
  'patek':       { bezel: '#1F3A5F', dial: '#2B4C7E', fg: '#ffffff' },
  'ap':          { bezel: '#2E4A6B', dial: '#1C3557', fg: '#ffffff' },
  'omega':       { bezel: '#B00020', dial: '#111111', fg: '#ffffff' },
  'cartier':     { bezel: '#8B0000', dial: '#F5F0E1', fg: '#8B0000' },
  'tudor':       { bezel: '#7B0F0F', dial: '#1a1a1a', fg: '#ffffff' },
  'grand-seiko': { bezel: '#4A5A6A', dial: '#E8EDF2', fg: '#2B3A4A' },
  'haute':       { bezel: '#2A2A2A', dial: '#0E0E0E', fg: '#C0A062' },
};

/** Per-market dial overrides where the watch is actually known for its colour. */
const DIAL_OVERRIDE: Record<string, Partial<{ bezel: string; dial: string; fg: string }>> = {
  'rolex-gmt-pepsi-126710blro': { bezel: '#B03A48' },
  'rolex-daydate-40-228238': { bezel: '#D4AF37', dial: '#3A3320', fg: '#F5E6A8' },
  'gs-snowflake-sbga211': { dial: '#F7FAFC' },
  'cartier-tank-must-wsta0041': { dial: '#141414', fg: '#F5F0E1' },
  'tudor-pelagos-39': { bezel: '#1E2A38', dial: '#0F1620', fg: '#ffffff' },
};

interface Props { marketId: string; size?: number; className?: string; bare?: boolean }

export function WatchImage({ marketId, size = 36, className, bare = false }: Props) {
  const [failed, setFailed] = useState(false);
  const market = getMarketById(marketId);

  // Path convention rather than a config field: drop a file into public/images/watches/ and it
  // appears with no code change. Stored locally and resized (320px webp) rather than hotlinked —
  // hotlinking would also steal the origin's bandwidth and break the moment they rotate a URL.
  // Any market without a file falls through to the generated dial below.
  //
  // The webp files are BACKGROUND-REMOVED with an ML segmenter (rembg / U2Net), so the watch
  // has a clean transparent alpha — no studio-white disc, no leftover highlight blobs.
  //   bare=false (default): circular chip, for thumbnails.
  //   bare=true:            floats free on a transparent bg with a soft shadow — for the hero.
  const src = market ? `/images/watches/${marketId}.webp?v=${IMG_VERSION}` : null;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={market!.name}
        width={size}
        height={size}
        className={className}
        loading="lazy"
        onError={() => setFailed(true)}
        style={bare ? {
          objectFit: "contain", flexShrink: 0, display: "block",
          filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.55))",
        } : {
          borderRadius: "50%", objectFit: "contain", background: "var(--elevated)",
          flexShrink: 0, display: "block",
        }}
      />
    );
  }

  const base = market ? BRAND_STYLE[market.category] : BRAND_STYLE.haute;
  const style = { ...base, ...(DIAL_OVERRIDE[marketId] ?? {}) };

  // A dial, not a 3-letter code: watches are round and read instantly at 34px, where "CHI"
  // in a square never read as a sneaker.
  const label = shortCode(market?.referenceNumber ?? marketId);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label={market?.name ?? marketId}
      style={{ borderRadius: "50%", flexShrink: 0, display: 'block' }}
    >
      <rect width="40" height="40" rx="20" fill="var(--card, #101010)" />
      <circle cx="20" cy="20" r="16" fill={style.bezel} />
      <circle cx="20" cy="20" r="12.5" fill={style.dial} />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.75" />
      <text
        x="20"
        y="20"
        textAnchor="middle"
        dominantBaseline="central"
        fill={style.fg}
        fontSize="8.5"
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {label}
      </text>
    </svg>
  );
}

/** First 3 alphanumerics of the reference — "116500LN" → "116", "SBGA211" → "SBG". */
function shortCode(ref: string): string {
  const cleaned = ref.replace(/[^A-Za-z0-9]/g, "");
  return (cleaned.slice(0, 3) || "WCH").toUpperCase();
}

/**
 * Large decorative dial for the hero. The list dial above is tuned for 34px — a bezel ring and
 * three characters — and blowing it up to 170px just makes a giant donut with a number in it.
 * This is the same palette but drawn as an actual watch: markers, hands, subdials.
 * Decorative only: aria-hidden, no reference code, never a fallback for real art.
 */
export function WatchHeroArt({ marketId, size = 170 }: { marketId: string; size?: number }) {
  const market = getMarketById(marketId);
  const base = market ? BRAND_STYLE[market.category] : BRAND_STYLE.rolex;
  const s = { ...base, ...(DIAL_OVERRIDE[marketId] ?? {}) };
  const markers = Array.from({ length: 12 }, (_, i) => i * 30);

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <radialGradient id="wh-dial" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </radialGradient>
      </defs>

      {/* lugs */}
      <rect x="86" y="6" width="28" height="26" rx="7" fill={s.bezel} opacity="0.85" />
      <rect x="86" y="168" width="28" height="26" rx="7" fill={s.bezel} opacity="0.85" />

      <circle cx="100" cy="100" r="88" fill={s.bezel} />
      <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <circle cx="100" cy="100" r="72" fill={s.dial} />
      <circle cx="100" cy="100" r="72" fill="url(#wh-dial)" />
      <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" />

      {markers.map((deg) => {
        const r1 = deg % 90 === 0 ? 56 : 62;
        const rad = ((deg - 90) * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={100 + Math.cos(rad) * r1} y1={100 + Math.sin(rad) * r1}
            x2={100 + Math.cos(rad) * 67} y2={100 + Math.sin(rad) * 67}
            stroke={s.fg} strokeWidth={deg % 90 === 0 ? 3.5 : 1.8} strokeLinecap="round" opacity="0.9"
          />
        );
      })}

      {/* chronograph subdials */}
      {[[70, 100], [130, 100], [100, 138]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="17" fill="rgba(0,0,0,0.28)" stroke={s.fg} strokeWidth="0.8" opacity="0.65" />
      ))}

      {/* hands, parked at ~10:10 the way every watch ad shoots them */}
      <line x1="100" y1="100" x2="66" y2="72" stroke={s.fg} strokeWidth="5" strokeLinecap="round" />
      <line x1="100" y1="100" x2="140" y2="66" stroke={s.fg} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="100" y1="100" x2="118" y2="146" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="100" cy="100" r="4.5" fill={s.fg} />
      <circle cx="100" cy="100" r="1.8" fill={s.dial} />

      {/* crown */}
      <rect x="186" y="92" width="10" height="16" rx="2.5" fill={s.bezel} />
    </svg>
  );
}
