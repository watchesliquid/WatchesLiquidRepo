"use client";

/**
 * The WL contract address, displayed in full and copyable in one click.
 *
 * Shown in full rather than truncated. A shortened CA is the thing people paste into a swap and
 * lose money on, and it is also exactly what an impersonator relies on — "0x5B0e…eef6" matches a
 * lookalike address that shares a prefix and suffix, so truncation removes the only part a reader
 * could actually check. The explorer link is the confirmation path.
 */

import { useState } from "react";
import { WL_TOKEN } from "@/lib/token";
import { ROBINHOOD_MAINNET, tokenUrl } from "shared/chain";

// Pinned to mainnet rather than targetChain(). The token is deployed on 4663 and nowhere else,
// so a testnet build must still link at the mainnet explorer — following the app's target would
// produce a confident link to a page that does not exist.
const EXPLORER = tokenUrl(ROBINHOOD_MAINNET, WL_TOKEN.address);

export function ContractAddress({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(WL_TOKEN.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked on insecure origins. The address is on screen in full, so the user
      // can still select it by hand — saying nothing beats a button that lies about succeeding.
      setCopied(false);
    }
  };

  return (
    <div className={`ca-block${compact ? " ca-compact" : ""}`}>
      <span className="ca-label">${WL_TOKEN.symbol} Contract</span>
      <div className="ca-row">
        <code className="ca-value" title={WL_TOKEN.address}>{WL_TOKEN.address}</code>
        <button type="button" onClick={copy} className="ca-copy" aria-label="Copy contract address">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <a className="ca-verify" href={EXPLORER} target="_blank" rel="noopener noreferrer">
        Verify on explorer ↗
      </a>
    </div>
  );
}
