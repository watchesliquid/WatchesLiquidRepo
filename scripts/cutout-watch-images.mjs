// Remove the studio background from watch product shots, in place.
//   cd frontend && node ../scripts/cutout-watch-images.mjs
// (must run from frontend/ — that is where sharp resolves)
//
// Flood-fills from the border inward and only clears white CONNECTED to the edge, so the
// white dials on the Day-Date / Snowflake / White Birch / Cartiers survive. A plain
// brightness threshold would punch holes straight through them.
import sharp from "sharp";
import { readdirSync } from "fs";
const D = "public/images/watches";

async function cutout(file) {
  const { data, info } = await sharp(`${D}/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const idx = (x, y) => (y * W + x) * C;
  const isBg = (x, y) => {
    const i = idx(x, y);
    const mx = Math.max(data[i], data[i+1], data[i+2]);
    const mn = Math.min(data[i], data[i+1], data[i+2]);
    return mn > 228 && (mx - mn) < 16;   // bright AND near-neutral
  };
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y++) stack.push([0, y], [W - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (seen[p] || !isBg(x, y)) continue;
    seen[p] = 1;
    stack.push([x+1, y], [x-1, y], [x, y+1], [x, y-1]);
  }
  let cleared = 0;
  for (let p = 0; p < W * H; p++) if (seen[p]) { data[p*C+3] = 0; cleared++; }
  // Feather so the edge isn't jagged against the dark UI.
  const soft = Buffer.from(data);
  for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
    const p = y*W + x;
    if (seen[p]) continue;
    let n = 0;
    if (seen[p-1]) n++; if (seen[p+1]) n++; if (seen[p-W]) n++; if (seen[p+W]) n++;
    if (n) soft[p*C+3] = Math.round(255 * (1 - n/5));
  }
  await sharp(soft, { raw: { width: W, height: H, channels: C } })
    .webp({ quality: 88, alphaQuality: 100 }).toFile(`${D}/${file}.tmp`);
  return Math.round(cleared / (W*H) * 100);
}

for (const f of readdirSync(D).filter(x => x.endsWith(".webp"))) {
  const pct = await cutout(f);
  // <8% means the shot isn't on white (e.g. RM 011 on black) — leave the original alone.
  if (pct < 8) { console.log(`  skip (${pct}%, not a white bg): ${f}`); continue; }
  console.log(`  ${String(pct).padStart(3)}% removed: ${f}`);
}
console.log("\nReview the .tmp files, then: for f in public/images/watches/*.webp.tmp; do mv -f \"$f\" \"${f%.tmp}\"; done");
