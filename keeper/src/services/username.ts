/**
 * Usernames — the display identity on share cards and the leaderboard.
 *
 * Two things make this more than a string field.
 *
 * 1. Claiming one is a check-and-set on shared state, so it obeys the same rule as balances:
 *    nothing may `await` between reading "is this taken?" and writing the claim. `claimUsername`
 *    is synchronous end to end. An async uniqueness check would let two requests both observe
 *    "free" and both write, and the loser would silently be impersonating the winner.
 *
 * 2. A username appears on an image that leaves the platform and gets reposted with no context.
 *    That makes impersonation the real risk, not profanity: "support", "watchesliquid_team" or
 *    "admin" on a PnL card is a working phishing lure the moment someone DMs it around. Reserved
 *    names are therefore matched after collapsing the substitutions people actually use to get
 *    around such a list, so `adm1n`, `4dmin` and `_admin_` are all refused.
 */

/** Never claimable. Matched after normalisation below, so variants are covered without listing them. */
const RESERVED = [
  "admin", "administrator", "mod", "moderator", "support", "help", "helpdesk",
  "official", "staff", "team", "system", "root", "owner", "founder",
  "watchesliquid", "watchperps", "watches", "liquid",
  "null", "undefined", "anonymous", "deleted", "everyone", "here",
];

/**
 * Collapse the substitutions used to dodge a reserved list: leet digits to letters, then strip
 * anything that is not a letter. "_4dm1n_" and "a.d.m.i.n" both land on "admin".
 *
 * Deliberately one-way and only used for the reserved check — the stored username keeps the
 * characters the user actually chose.
 */
function normalizeForReserved(name: string): string {
  return name
    .toLowerCase()
    .replace(/[04]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/[^a-z]/g, "");
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Format check only — does not consider whether it is taken. Returns null when acceptable,
 * otherwise the reason, phrased for display to the user.
 */
export function validateUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return "Username must be text";
  const name = raw.trim();

  if (name.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`;
  if (name.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters`;

  // Lowercase only. Mixed case would make `Admin` and `admin` look distinct in a list while
  // colliding in the uniqueness check, and the card renders uppercase anyway.
  if (!/^[a-z0-9_]+$/.test(name)) return "Use lowercase letters, numbers and underscores only";
  if (!/^[a-z0-9]/.test(name)) return "Username must start with a letter or number";
  if (name.includes("__")) return "Username cannot contain repeated underscores";
  if (name.endsWith("_")) return "Username cannot end with an underscore";

  // A name that is all digits reads as an id and invites confusion with rank or position numbers.
  if (/^\d+$/.test(name)) return "Username cannot be only numbers";

  const collapsed = normalizeForReserved(name);
  if (RESERVED.includes(collapsed)) return "That username is reserved";

  // Catch the "official"-adjacent construction: a reserved word plus decoration, e.g.
  // "watchesliquid_support" or "adminteam". Substring rather than equality, on the collapsed form.
  for (const word of RESERVED) {
    if (word.length >= 5 && collapsed.includes(word)) return "That username is reserved";
  }

  return null;
}

/** Case-insensitive, and ignores the user's own current name so re-saving it is not a collision. */
export function isUsernameTaken(users: any[], name: string, exceptUserId?: string): boolean {
  const target = name.toLowerCase();
  return users.some(
    (u) => typeof u.username === "string" && u.username.toLowerCase() === target && u.id !== exceptUserId,
  );
}

export type ClaimResult = { ok: true; username: string } | { ok: false; error: string };

/**
 * Validate and claim in one synchronous pass.
 *
 * SYNCHRONOUS ON PURPOSE — see the header. The caller persists afterwards; the in-memory claim
 * is what makes the uniqueness check meaningful, and Node's single thread is what makes it
 * atomic. Do not make this async, and do not split the check from the write.
 */
export function claimUsername(users: any[], user: any, raw: unknown): ClaimResult {
  const invalid = validateUsername(raw);
  if (invalid) return { ok: false, error: invalid };

  const name = (raw as string).trim();
  if (isUsernameTaken(users, name, user.id)) return { ok: false, error: "That username is taken" };

  user.username = name;
  return { ok: true, username: name };
}

/**
 * What to show when no username is set: the same truncated-uuid pseudonym the leaderboard uses.
 * The id is a random UUID, not anything derived from the wallet, so a prefix of it reveals
 * nothing about the account.
 */
export function displayName(user: any): string {
  return typeof user?.username === "string" && user.username ? user.username : String(user?.id ?? "").slice(0, 8);
}
