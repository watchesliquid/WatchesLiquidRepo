/**
 * Regression test: no interactive element may be nested inside another.
 *
 * Pure — no server, no browser. Run with: npx tsx tests/interactive-nesting.test.ts
 *
 * The bug this pins, observed on /portfolio 2026-08-02: the open-position row was a <button>
 * containing Share and Close <button>s. HTML forbids interactive content inside a button, and
 * the page is prerendered, so the browser's parser closed the outer button early and reparented
 * the inner ones into siblings. The resulting DOM no longer matched what React expected, so
 * hydration bound handlers to the wrong nodes: clicking Close on one position ran a DIFFERENT
 * row's navigate handler and opened the trade page for an unrelated watch.
 *
 * Two things make this worth a test rather than a comment. It is invisible in review — the JSX
 * reads perfectly sensibly. And the obvious defence, stopPropagation on the inner button, does
 * nothing, because the handler that fires is not the one attached to the clicked element.
 *
 * The fix is always the same: the container becomes a div (role="button" + tabIndex if it needs
 * to stay keyboard-reachable) and the real buttons stay real buttons.
 *
 * Depth-tracked rather than regex-matched on purpose: a "<button> ... <button>" regex over JSX
 * backtracks catastrophically and hangs.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "frontend", "src");

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Strip comments and string literals so a `<button` inside prose or a className cannot match. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/**
 * Walk the open/close tags of one element name and report the line of any opening tag that
 * occurs while depth is already > 0. Linear in file length — no backtracking.
 */
function nestedOpenings(src: string, tag: string): number[] {
  const token = new RegExp(`<${tag}(?=[\\s/>])|</${tag}\\s*>`, "g");
  const hits: number[] = [];
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(src)) !== null) {
    if (m[0].startsWith("</")) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) hits.push(src.slice(0, m.index).split("\n").length);
    // A self-closing <button ... /> never contains anything, so it cannot open a nesting level.
    const gt = src.indexOf(">", m.index);
    const selfClosing = gt > 0 && src[gt - 1] === "/";
    if (!selfClosing) depth++;
  }
  return hits;
}

const files = tsxFiles(SRC);
check("there are components to scan", files.length > 0, true);

const offenders: string[] = [];
for (const file of files) {
  const src = stripNoise(readFileSync(file, "utf-8"));
  for (const tag of ["button", "a"]) {
    for (const line of nestedOpenings(src, tag)) {
      offenders.push(`${relative(root, file)}:${line} — <${tag}> inside <${tag}>`);
    }
  }
}

check("no <button> or <a> is nested inside its own kind", offenders, []);
if (offenders.length) for (const o of offenders) console.log(`        ${o}`);

// The specific row that regressed, pinned by shape rather than by line number.
{
  const raw = readFileSync(join(SRC, "app", "portfolio", "page.tsx"), "utf-8");
  // stripNoise blanks string literals, which is right for tag-nesting but would erase the very
  // attribute values checked below — so the attribute assertions read the raw source.
  const page = stripNoise(raw);
  const rowStart = page.indexOf("className=");
  check("the portfolio page still renders rows", rowStart > -1, true);
  // Whatever wraps the Close button must not be a <button>, or the hydration scramble is back.
  check("the position row is not a button", /<button[^>]*className=\{?["']?mkt-card/.test(raw), false);
  check("Close is still a real button", /<button[\s\S]{0,600}?Close\s*<\/button>/.test(raw), true);
  // Keyboard reachability is what a div silently costs, so it is pinned too.
  check("the row stays keyboard reachable", /role="button"[\s\S]{0,300}tabIndex=\{0\}|tabIndex=\{0\}[\s\S]{0,300}role="button"/.test(raw), true);
}

console.log(failed === 0 ? "\ninteractive nesting: all cases as specified" : `\ninteractive nesting: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
