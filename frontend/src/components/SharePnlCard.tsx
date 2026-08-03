"use client";

/**
 * Shareable PnL card — the image a trader posts after a good (or bad) trade.
 *
 * All drawing lives in lib/pnl-card.ts, which is React-free and import-free so the exact code
 * that ships can be rendered headlessly and inspected. This file is only the modal around it:
 * resolve the market, wire the buttons, own the toggle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getMarketById } from "shared/markets";
import { watchPalette, IMG_VERSION as WATCH_IMG_VERSION } from "./WatchImage";
import { drawPnlCard, CARD_W, CARD_H, CARD_SCALE } from "@/lib/pnl-card";

/** The UI still brands itself watchperps while the domain is separate. One place to change it. */
const BRAND = "WATCHPERPS";

/**
 * The domain is read off the browser rather than hardcoded. The card is only ever drawn on the
 * site it advertises, so location.hostname is always the right answer — and it stays right
 * across dev, staging and any future rename without a config value to forget. It also keeps the
 * domain out of the source, which matters because the public audit copy of this repo must not
 * contain it.
 */
function siteName(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.replace(/^www\./, "");
}

export interface SharePosition {
  marketId: string;
  direction: "long" | "short";
  leverage: number;
  entryPrice: number;
  /** Mark for an open position, close price for a settled one. */
  exitPrice: number;
  collateral: number;
  pnl: number;
  settled: boolean;
}

interface Props {
  position: SharePosition;
  displayName: string;
  onClose: () => void;
}

export function SharePnlCard({ position, displayName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showAmounts, setShowAmounts] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const [art, setArt] = useState<HTMLImageElement | null>(null);

  const roe = position.collateral > 0 ? (position.pnl / position.collateral) * 100 : 0;
  const market = getMarketById(position.marketId);

  /**
   * Load the market's real art before drawing. Same path and cache-buster as WatchImage, so the
   * card shows the same watch the rest of the app does.
   *
   * Same-origin, and deliberately NOT crossOrigin: these are served from our own /public, and a
   * tainted canvas makes toBlob throw — the export would break with no visible symptom until a
   * user clicked save. A missing or broken file just leaves `art` null and the generated dial
   * takes over, which is the same fallback the thumbnails use.
   */
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setArt(img); };
    img.onerror = () => { if (live) setArt(null); };
    img.src = `/images/watches/${position.marketId}.webp?v=${WATCH_IMG_VERSION}`;
    return () => { live = false; };
  }, [position.marketId]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawPnlCard(ctx, {
      brand: BRAND,
      site: siteName(),
      displayName,
      referenceNumber: market?.referenceNumber ?? position.marketId.toUpperCase(),
      marketName: market?.name ?? "",
      direction: position.direction,
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      exitPrice: position.exitPrice,
      pnl: position.pnl,
      roe,
      settled: position.settled,
      showAmounts,
      palette: watchPalette(position.marketId),
      watchImage: art,
    });
  }, [position, displayName, showAmounts, roe, market, art]);

  // Esc closes, matching every other dismissable surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = useCallback(() => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${BRAND.toLowerCase()}-${position.marketId}-${position.direction}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Image saved");
    }, "image/png");
  }, [position]);

  const copy = useCallback(() => {
    // Image clipboard writes are unsupported on Firefox and on any non-secure origin. Say so
    // rather than failing silently — Save image always works.
    canvasRef.current?.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setStatus("Copied — paste it into your post");
      } catch {
        setStatus("Your browser blocks image copy. Use Save image instead.");
      }
    }, "image/png");
  }, []);

  // The X intent cannot carry an image, so the flow is copy-or-save then paste. Saying that
  // plainly beats a button that looks like it posts the picture and doesn't.
  const tweet = useCallback(() => {
    const text =
      `${position.direction.toUpperCase()} ${position.leverage}x ` +
      `${market?.referenceNumber ?? position.marketId}  ` +
      `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%\n\n` +
      `Simulated-price perps on ${siteName()}`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }, [position, roe, market]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share position"
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="stat-card" style={{ maxWidth: 760, width: "100%", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Share position
          </div>
          <button onClick={onClose} className="btn" style={{ padding: "4px 10px", fontSize: 11 }}>Close</button>
        </div>

        <canvas
          ref={canvasRef}
          width={CARD_W * CARD_SCALE}
          height={CARD_H * CARD_SCALE}
          style={{ width: "100%", height: "auto", borderRadius: 10, display: "block", border: "1px solid var(--border, #ffffff14)" }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 2px", fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={showAmounts} onChange={(e) => setShowAmounts(e.target.checked)} />
          Show dollar amounts (uncheck to share the percentage only)
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={download} className="btn btn-primary" style={{ fontSize: 12 }}>Save image</button>
          <button onClick={copy} className="btn" style={{ fontSize: 12 }}>Copy image</button>
          <button onClick={tweet} className="btn" style={{ fontSize: 12 }}>Post on X</button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, minHeight: 16 }}>
          {status ?? "Posting on X opens a composer — paste the copied image into it."}
        </div>
      </div>
    </div>
  );
}
