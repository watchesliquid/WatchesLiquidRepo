/**
 * Every outbound/community link in one place — the rail, the landing footer and anywhere else
 * all read from here, so a link can never be right in one place and stale in another.
 *
 * Links that don't exist yet are simply absent rather than pointed at "/docs" as a placeholder.
 * A dead-end social icon is worse than no icon: it looks like a broken site, and it burns the
 * click of someone who actually wanted to find you.
 */

export interface SocialLink {
  /** Icon key. "x" uses the brand glyph; the rest use the generic icon set. */
  key: "x" | "dex" | "docs";
  label: string;
  href: string;
  /** External links get target=_blank + rel=noopener. */
  external: boolean;
}

export const SOCIALS: SocialLink[] = [
  { key: "x", label: "X", href: "https://x.com/WatchesLiquid", external: true },
  // ── DEX ──
  // No token is live yet. When it is, uncomment and drop the real URL in — nothing else needs
  // to change; the rail and the footer both render from this array.
  // { key: "dex", label: "Buy $WATCH", href: "https://dexscreener.com/…", external: true },
  { key: "docs", label: "Docs", href: "/docs", external: false },
];
