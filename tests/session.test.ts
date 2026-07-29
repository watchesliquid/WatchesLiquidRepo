/**
 * Regression test for how the session is stored and how the chain is reached.
 *
 * Pure — no server, no chain. Run with: npx tsx tests/session.test.ts
 *
 * Both properties here are the kind that regress silently, because reverting either one leaves
 * a working application. A token moved back into localStorage still logs users in; a single RPC
 * still serves every read until the day it does not.
 *
 * These are source assertions rather than behavioural ones. That is deliberate: the behaviour
 * (a cookie the browser will not expose to script) cannot be observed from Node, but the code
 * that produces it can be.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)}${pass ? "" : ` got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// ── 1. the session must not be reachable from JavaScript ──────────────────────
{
  const auth = read("keeper", "src", "routes", "auth.ts");

  check("session cookie is HttpOnly", /"HttpOnly"/.test(auth), true);
  check("session cookie is SameSite=Strict", /"SameSite=Strict"/.test(auth), true);
  check("Secure is set outside development", /NODE_ENV === "production".*\n?.*Secure|Secure.*production/s.test(auth), true);

  // The header path must survive: the CLI scripts have no cookie jar, and tokens issued before
  // the cookie existed stay valid for their full 7 days.
  check("bearer header is still accepted", /Bearer /.test(auth), true);

  // Logout has to be a server round trip — the client cannot clear an httpOnly cookie.
  check("logout route exists", /"\/logout"/.test(auth), true);
}

// ── 2. no client-side code may store the token ────────────────────────────────
// The whole point of the cookie is that a single XSS cannot walk off with a 7-day session.
// Putting the token back into localStorage anywhere undoes it everywhere.
{
  const clientFiles = [
    ["frontend", "src", "lib", "api.ts"],
    ["frontend", "src", "hooks", "useAuth.tsx"],
    ["frontend", "src", "app", "admin", "page.tsx"],
  ];

  for (const parts of clientFiles) {
    const src = read(...parts);
    // Strip comments first: these files explain WHY localStorage is gone, and that prose must
    // not trip the check it is describing.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const name = parts.slice(1).join("/");

    check(`${name}: no localStorage`, /localStorage/.test(code), false);

    // Only files that call fetch directly need to opt into sending the cookie. useAuth goes
    // through the api client and would fail a blanket check while being perfectly correct —
    // so the condition is "if you call fetch, you send credentials", not "every file must".
    if (/\bfetch\(/.test(code)) {
      check(`${name}: raw fetch sends credentials`, /credentials:\s*"include"/.test(code), true);
    }
  }
}

// ── 3. the chain must be reachable through more than one endpoint ─────────────
{
  const evm = read("keeper", "src", "services", "evm.ts");

  check("a fallback transport is used", /fallback\(/.test(evm), true);
  check("failover endpoints are configurable", /EVM_RPC_FALLBACKS/.test(evm), true);
  check("endpoints are verified against the chain id", /verifyRpcEndpoints/.test(evm), true);

  // A failover onto the wrong chain is worse than no failover: reads resolve against a foreign
  // block height the moment the primary hiccups, and the scanner credits nobody while looking
  // healthy. This must throw, not warn.
  check("a wrong-chain endpoint throws", /throw new Error\([\s\S]{0,200}expected \$\{cfg\.chainId\}/.test(evm), true);

  // Writes must fail over too, or a withdrawal still dies with the primary.
  check("the wallet client shares the transport", /createWalletClient\(\{[^}]*transport: transport\(\)/.test(evm), true);
}

// ── 4. response hardening ─────────────────────────────────────────────────────
{
  const index = read("keeper", "src", "index.ts");
  for (const header of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]) {
    check(`${header} is set`, new RegExp(header).test(index), true);
  }
}

console.log(failed === 0 ? "\nsession: all cases as specified" : `\nsession: ${failed} case(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
