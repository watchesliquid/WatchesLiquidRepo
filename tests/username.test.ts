/**
 * Regression test for usernames — the display identity that ends up on a share card.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/username.test.ts
 *
 * The two properties worth pinning:
 *   - impersonation is refused, including the substitutions used to dodge a reserved-word list.
 *     A card reading "@support" or "@watchesliquid_team" is a working phishing lure once the
 *     image is circulating with no context.
 *   - claiming is a synchronous check-and-set, like every other write to shared state here. Two
 *     concurrent claims must not both succeed.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateUsername, claimUsername, isUsernameTaken, displayName } from "../keeper/src/services/username";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}
const ok = (raw: string) => validateUsername(raw) === null;

// ── format ───────────────────────────────────────────────────────────────────
check("a normal name is accepted", ok("watchguy"), true);
check("digits and underscores are fine", ok("dial_dude_92"), true);
check("too short is refused", ok("ab"), false);
check("too long is refused", ok("a".repeat(21)), false);
check("exactly the minimum is fine", ok("abc"), true);
check("exactly the maximum is fine", ok("a".repeat(20)), true);
check("uppercase is refused", ok("WatchGuy"), false);
check("spaces are refused", ok("watch guy"), false);
check("leading underscore is refused", ok("_watchguy"), false);
check("trailing underscore is refused", ok("watchguy_"), false);
check("doubled underscore is refused", ok("watch__guy"), false);
check("all digits is refused", ok("12345"), false);
check("non-string is refused", ok(42 as any), false);
check("emoji is refused", ok("watch🔥guy"), false);

// Homograph-ish padding: zero-width and lookalike characters must not slip through the charset.
check("zero-width joiner is refused", ok("watch‍guy"), false);
check("cyrillic lookalike is refused", ok("wаtchguy"), false); // the 'а' here is U+0430

// ── impersonation ────────────────────────────────────────────────────────────
check("admin is reserved", ok("admin"), false);
check("support is reserved", ok("support"), false);
check("the platform name is reserved", ok("watchesliquid"), false);
check("leet admin is reserved", ok("4dm1n"), false);
check("leet support is reserved", ok("supp0rt"), false);
check("underscored admin is reserved", ok("a_d_m_i_n"), false);
check("reserved word plus decoration is refused", ok("watchesliquid_team"), false);
check("reserved word as a suffix is refused", ok("realwatchesliquid"), false);
// The substring rule only applies to words of 5+ chars, so short ones do not eat innocent names.
check("a short reserved word does not over-match", ok("modest_trader"), true);
check("an ordinary name containing 'team' is fine", ok("teamplayer"), true);

// ── uniqueness and claiming ──────────────────────────────────────────────────
{
  const users: any[] = [{ id: "u1" }, { id: "u2" }];

  const first = claimUsername(users, users[0], "dialsniper");
  check("first claim succeeds", first, { ok: true, username: "dialsniper" });
  check("it is written to the user", users[0].username, "dialsniper");

  const second = claimUsername(users, users[1], "dialsniper");
  check("a second user cannot take it", second.ok, false);
  check("the loser is not assigned it", users[1].username, undefined);

  const cased = claimUsername(users, users[1], "DialSniper");
  check("case variation is refused by the charset", cased.ok, false);

  check("taken is case-insensitive", isUsernameTaken(users, "DIALSNIPER"), true);
  check("re-saving your own name is allowed", claimUsername(users, users[0], "dialsniper").ok, true);

  const renamed = claimUsername(users, users[0], "bezelchaser");
  check("renaming succeeds", renamed.ok, true);
  check("the old name frees up", isUsernameTaken(users, "dialsniper"), false);
  check("another user can now take it", claimUsername(users, users[1], "dialsniper").ok, true);

  // Whitespace is trimmed rather than being a way to mint a near-duplicate of a taken name.
  check("padded duplicate is still a duplicate", claimUsername(users, users[0], "  dialsniper  ").ok, false);
}

// ── the claim is synchronous ─────────────────────────────────────────────────
// Not a style preference. If claimUsername returned a promise, two requests could both observe
// "free" before either wrote, and the loser would silently be impersonating the winner. Node's
// single thread is what makes the check-and-set atomic, and only if nothing awaits inside it.
{
  const users: any[] = [{ id: "s1" }, { id: "s2" }];
  const result = claimUsername(users, users[0], "syncheck");
  check("claimUsername does not return a promise", result instanceof Promise, false);
  check("the write is visible immediately", users[0].username, "syncheck");
  check("a racing claim sees it already taken", claimUsername(users, users[1], "syncheck").ok, false);
}

// ── display name fallback ────────────────────────────────────────────────────
{
  const withName = { id: "3f2a1b9c-dead-beef-0000-000000000000", username: "bezelchaser" };
  const without = { id: "3f2a1b9c-dead-beef-0000-000000000000" };
  check("a username wins", displayName(withName), "bezelchaser");
  check("otherwise the uuid prefix is used", displayName(without), "3f2a1b9c");
  check("an empty username falls back", displayName({ ...without, username: "" }), "3f2a1b9c");
  // The id is a random UUID, never derived from the wallet, so a prefix reveals nothing.
  check("the fallback is not the whole id", displayName(without).length, 8);
}

// ── what the share card may render ───────────────────────────────────────────
// The card is an image built to leave the platform and be reposted with no context, so it is the
// worst place for a leak and the worst place for a missing disclosure.
//
// The leaderboard already shipped the mistake this guards: publishing `pnl` next to
// `roi = pnl / balance` made every balance solvable. The card publishes pnl and ROE, which
// yields the POSITION's collateral — inherent to any PnL card, and why amounts can be hidden.
// The account balance, the wallet address and the raw userId must never be on it at all.
{
  const frontend = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "src");
  // Strip comments: both files explain the leak at length and the prose would match itself.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const modal = strip(readFileSync(join(frontend, "components", "SharePnlCard.tsx"), "utf-8"));
  const draw = strip(readFileSync(join(frontend, "lib", "pnl-card.ts"), "utf-8"));
  const both = `${modal}\n${draw}`;

  check("the card never reads a balance", /balance/i.test(both), false);
  check("the card never reads a wallet address", /publicKey|walletAddress|0x/i.test(both), false);
  check("the card never reads a raw user id", /userId|user\.id/.test(both), false);
  check("ROE is computed from collateral", /pnl\s*\/\s*(position\.)?collateral/.test(modal), true);

  // The card previously asserted a "SIMULATED PRICES" footer. That was removed 2026-08-02 at the
  // owner's explicit instruction, with the evidence in front of them that prices are in fact
  // still simulated, so these two checks were deleted rather than left failing. Do not re-add
  // them as if their absence were the regression — the decision is recorded in CLAUDE.md and in
  // the header of pnl-card.ts.
  check("amounts can be withheld", /showAmounts/.test(both), true);

  // The wordmark must match the app header. It did not: the card shipped "WATCHPERPS", taken
  // from a note in the project guide claiming the UI had not been rebranded, which was stale by
  // then. The card is the one surface where a wrong wordmark travels off the site.
  const shell = readFileSync(join(frontend, "components", "AppShell.tsx"), "utf-8");
  const logo = shell.match(/<span>([^<]+)<\/span>\s*<span className="dot">([^<]+)<\/span>/);
  check("the app header has a two-part logo", !!logo, true);
  if (logo) {
    const lead = (modal.match(/BRAND_LEAD\s*=\s*"([^"]+)"/) ?? [])[1] ?? "";
    const tail = (modal.match(/BRAND_TAIL\s*=\s*"([^"]+)"/) ?? [])[1] ?? "";
    check("the card wordmark matches the header", [lead.toLowerCase(), tail.toLowerCase()], [logo[1].toLowerCase(), logo[2].toLowerCase()]);
  }
  // An open position's number is not booked profit and must not read as if it were.
  check("unrealised is labelled as such", /UNREALISED/.test(draw), true);
  // The drawing must stay renderable outside React, which is what makes it visually verifiable.
  check("the drawing module imports nothing", /^\s*import\s/m.test(draw), false);
  // The domain is read from location.hostname, never written down. A literal here would be
  // correct in production and wrong everywhere else, and the public audit copy of this repo is
  // required to contain no domain at all — this caught exactly that before it shipped.
  check("no domain is hardcoded", /["'`][\w-]+\.(xyz|com|io|fun|app)["'`]/.test(both), false);
  check("the site name comes from the browser", /location\.hostname/.test(modal), true);
}

console.log(failed === 0 ? "\nusername: all cases as specified" : `\nusername: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
