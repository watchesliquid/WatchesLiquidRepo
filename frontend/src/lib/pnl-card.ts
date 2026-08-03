/**
 * The shareable PnL card, drawn with canvas primitives.
 *
 * Deliberately free of React, of imports, and of any DOM beyond the 2D context it is handed.
 * That is what lets the exact code that ships be rendered headlessly and looked at — a card is a
 * visual artifact, and "it type-checks" says nothing about whether the dial overlaps the number.
 *
 * Rasterised rather than rendered from the DOM: html2canvas is a large dependency, it mis-reads
 * the CSS variables this theme is built on, and any cross-origin asset taints the canvas and
 * breaks the export silently.
 *
 * ── What must never appear here ───────────────────────────────────────────────
 * Account balance, wallet address, raw userId. The leaderboard shipped a bug where publishing
 * `pnl` beside `roi = pnl / balance` made every balance solvable by arithmetic; the same trap is
 * one field away on an image built to be reposted. What IS solvable is the position's own
 * collateral (pnl / roe) — inherent to any PnL card, and why `showAmounts` exists.
 *
 * ── Why the disclosure is in the pixels ───────────────────────────────────────
 * Prices here are simulated. This image is designed to leave the site and travel without
 * context, so a disclosure on the surrounding page is gone exactly when it matters. Do not
 * shrink it and do not make it optional.
 */

export const CARD_W = 1200;
export const CARD_H = 675;
/** Retina export: drawn at 2x, downscaled by CSS for preview. */
export const CARD_SCALE = 2;

const GREEN = "#22c55e";
const RED = "#ef4444";

export interface PnlCardData {
  brand: string;
  site: string;
  displayName: string;
  /** Leads the identity block — the platform identifies markets by reference on purpose. */
  referenceNumber: string;
  marketName: string;
  direction: "long" | "short";
  leverage: number;
  entryPrice: number;
  /** Mark for an open position, close price for a settled one. */
  exitPrice: number;
  pnl: number;
  roe: number;
  /** Open positions are labelled UNREALISED so a floating number never reads as booked. */
  settled: boolean;
  showAmounts: boolean;
  palette: { bezel: string; dial: string; fg: string };
  /**
   * The market's real background-removed art, already decoded. Optional: markets without a file
   * fall back to the generated dial, exactly as the app's thumbnails do.
   *
   * Handed in already-loaded rather than fetched here, so this module stays synchronous and
   * import-free. It must be same-origin — a cross-origin image taints the canvas and makes
   * toBlob throw, which would break the export with no visible symptom until someone clicks save.
   */
  watchImage?: CanvasImageSource | null;
}

export function drawPnlCard(ctx: CanvasRenderingContext2D, d: PnlCardData): void {
  const up = d.pnl >= 0;
  const accent = up ? GREEN : RED;

  ctx.save();
  ctx.scale(CARD_SCALE, CARD_SCALE);
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ── background ──
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, "#0b0d0f");
  bg.addColorStop(1, "#121417");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Directional glow — carries the result before any number is read.
  const glow = ctx.createRadialGradient(210, CARD_H - 40, 0, 210, CARD_H - 40, 620);
  glow.addColorStop(0, `${accent}2e`);
  glow.addColorStop(1, "#00000000");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ── header ──
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(d.brand, 64, 74);

  ctx.fillStyle = "#8b949e";
  ctx.font = `500 18px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText(`@${d.displayName}`, CARD_W - 64, 74);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#ffffff14";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 100);
  ctx.lineTo(CARD_W - 64, 100);
  ctx.stroke();

  // ── direction pill ──
  const pill = `${d.direction.toUpperCase()}  ${d.leverage}x`;
  ctx.font = `800 22px ${SANS}`;
  const pillW = ctx.measureText(pill).width + 44;
  ctx.fillStyle = `${accent}24`;
  roundRect(ctx, 64, 140, pillW, 48, 10);
  ctx.fill();
  ctx.strokeStyle = `${accent}66`;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 64, 140, pillW, 48, 10);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillText(pill, 86, 172);

  // ── market identity ──
  // Bounded so a long reference or name can never run under the dial art on the right.
  const TEXT_MAX = CARD_W - 64 - 380;
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText(fit(ctx, d.referenceNumber, TEXT_MAX), 64, 250);

  ctx.fillStyle = "#8b949e";
  ctx.font = `500 20px ${SANS}`;
  ctx.fillText(fit(ctx, d.marketName, TEXT_MAX), 64, 284);

  // ── hero number ──
  ctx.fillStyle = accent;
  ctx.font = `800 116px ${SANS}`;
  ctx.fillText(`${d.roe >= 0 ? "+" : ""}${d.roe.toFixed(2)}%`, 60, 410);

  ctx.fillStyle = "#8b949e";
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText(d.settled ? "RETURN ON COLLATERAL" : "UNREALISED RETURN ON COLLATERAL", 64, 442);

  // ── stat row ──
  const stats: Array<[string, string, boolean]> = [
    ["Entry", money(d.entryPrice), false],
    [d.settled ? "Exit" : "Mark", money(d.exitPrice), false],
  ];
  if (d.showAmounts) {
    // Grouped like the prices beside it. Without this a five-figure PnL renders "$12480.75"
    // next to "$187,400" and reads as a different kind of number.
    stats.push([
      d.settled ? "Realised PnL" : "Unrealised PnL",
      `${up ? "+" : "-"}$${Math.abs(d.pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      true,
    ]);
  }

  let x = 64;
  for (const [label, value, isPnl] of stats) {
    ctx.fillStyle = "#6e7681";
    ctx.font = `600 14px ${SANS}`;
    ctx.fillText(label.toUpperCase(), x, 502);

    ctx.fillStyle = isPnl ? accent : "#e6edf3";
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(value, x, 534);

    x += Math.max(ctx.measureText(value).width, 130) + 56;
  }

  // Sized against the empty right-hand column, not against the dial it replaced. The watch shots
  // are portrait (case plus bracelet), so a square bounding box spends most of its width on
  // nothing and the watch comes out far smaller than the space allows.
  drawArt(ctx, CARD_W - 250, 322, 185, d);

  // ── footer: the disclosure ──
  ctx.fillStyle = "#00000066";
  ctx.fillRect(0, CARD_H - 78, CARD_W, 78);
  ctx.strokeStyle = "#ffffff14";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CARD_H - 78);
  ctx.lineTo(CARD_W, CARD_H - 78);
  ctx.stroke();

  ctx.fillStyle = "#f0b429";
  ctx.font = `700 16px ${SANS}`;
  ctx.fillText("SIMULATED PRICES", 64, CARD_H - 46);

  ctx.fillStyle = "#8b949e";
  ctx.font = `500 15px ${SANS}`;
  ctx.fillText(
    "Prices are generated by a published model, not a live watch market. Not investment advice.",
    64,
    CARD_H - 22,
  );

  ctx.fillStyle = "#e6edf3";
  ctx.font = `600 17px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText(d.site, CARD_W - 64, CARD_H - 34);
  ctx.textAlign = "left";

  ctx.restore();
}

const SANS = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Watch prices reach six figures and the card has room, so show the exact number. */
function money(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Ellipsise to a pixel budget. Measured, not guessed at by character count. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Real photography when the market has it, the generated dial when it does not — the same
 * precedence the app's thumbnails use, so the card never shows a placeholder for a market that
 * has real art.
 *
 * `r` is a bounding RADIUS, not a width: the photo is fitted inside a 2r box with its aspect
 * ratio preserved, so a tall watch-on-strap shot and a square case shot both land at the same
 * visual weight instead of one being stretched.
 */
function drawArt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  d: PnlCardData,
): void {
  const img = d.watchImage;
  const iw = img ? (img as HTMLImageElement).width : 0;
  const ih = img ? (img as HTMLImageElement).height : 0;

  // A zero-dimension image means it never actually decoded. Falling through to the dial beats
  // drawing nothing and shipping a card with an empty hole in it.
  if (!img || !iw || !ih) {
    drawDial(ctx, cx, cy, r * 0.87, d.palette);
    return;
  }

  // Tinted halo in the market's own colour, so the photo sits in the composition rather than
  // floating on top of it.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
  halo.addColorStop(0, `${d.palette.bezel}3a`);
  halo.addColorStop(1, "#00000000");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  const scale = Math.min((r * 2) / iw, (r * 2) / ih);
  const w = iw * scale;
  const h = ih * scale;

  ctx.save();
  // The art is background-removed with a transparent alpha, so a shadow reads as the watch's own
  // rather than a rectangle behind it.
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

/**
 * The generated dial, in canvas primitives — the fallback for any market with no photograph.
 * Decorative and brand-free by design: no logos, no wordmarks.
 */
function drawDial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  pal: { bezel: string; dial: string; fg: string },
) {
  ctx.save();

  ctx.globalAlpha = 0.16;
  ctx.fillStyle = pal.bezel;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = pal.bezel;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // The dark palettes (haute, omega) are near-black by design, and on this near-black card the
  // whole dial disappeared. A light rim guarantees the silhouette reads against the background
  // whatever the palette does — cheaper and more predictable than special-casing colours.
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = pal.dial;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = pal.fg;
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i++) {
    const deg = i * 30;
    const rad = ((deg - 90) * Math.PI) / 180;
    const inner = deg % 90 === 0 ? r * 0.62 : r * 0.69;
    ctx.lineWidth = deg % 90 === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
    ctx.lineTo(cx + Math.cos(rad) * (r * 0.76), cy + Math.sin(rad) * (r * 0.76));
    ctx.stroke();
  }

  // hands, parked at 10:10 the way every watch ad shoots them
  ctx.strokeStyle = pal.fg;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - r * 0.38, cy - r * 0.32);
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.39);
  ctx.stroke();

  ctx.fillStyle = pal.fg;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
