/**
 * Verifies the /api/admin authorisation boundary end-to-end against a running keeper.
 *
 * The bug this exists to catch: every /api/admin route used to sit behind plain authMiddleware,
 * which proves a JWT is valid but not whose. Any logged-in user could read /api/admin/positions
 * and see the entire book. A 401-when-logged-out test does NOT catch that — you have to log in
 * as a non-admin and confirm 403.
 */
import { privateKeyToAccount } from "viem/accounts";
import { buildAuthMessage } from "shared/chain";

const API = "http://localhost:3001/api";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID ?? 46630);

async function login(pk: `0x${string}`): Promise<{ token: string; address: string }> {
  const account = privateKeyToAccount(pk);
  const message = buildAuthMessage(account.address, CHAIN_ID, Date.now());
  const signature = await account.signMessage({ message });
  const r = await fetch(`${API}/auth/wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: account.address, message, signature }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`login ${r.status}: ${JSON.stringify(body)}`);
  return { token: body.token, address: account.address.toLowerCase() };
}

async function probe(path: string, token?: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

let failures = 0;
function expect(label: string, actual: number, wanted: number, extra = "") {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${actual} (want ${wanted}) ${extra}`);
}

// The two standard Hardhat/Anvil test keys — published in their docs, hold nothing, and are
// safe to commit. They are here so the addresses are deterministic: run this against a keeper
// started with ADMIN_ADDRESSES=0x70997970c51812dc3a010c7d01b50e0d17dc79c8 (the first one).
// NEVER put a real key in this file.
const ADMIN_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const USER_PK = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;

// Wrapped in main() rather than top-level await: the scripts workspace is CommonJS.
async function main() {
const admin = await login(ADMIN_PK);
const user = await login(USER_PK);
console.log(`admin=${admin.address}\nuser =${user.address}\n`);

// The boundary itself.
expect("logged-out  /admin/overview", (await probe("/admin/overview")).status, 401);
expect("NON-admin   /admin/overview", (await probe("/admin/overview", user.token)).status, 403);
expect("NON-admin   /admin/positions", (await probe("/admin/positions", user.token)).status, 403);
expect("NON-admin   /admin/users", (await probe("/admin/users", user.token)).status, 403);
expect("admin       /admin/overview", (await probe("/admin/overview", admin.token)).status, 200);
expect("admin       /admin/users", (await probe("/admin/users", admin.token)).status, 200);
expect("admin       /admin/withdrawals", (await probe("/admin/withdrawals", admin.token)).status, 200);
expect("admin       /admin/audit", (await probe("/admin/audit", admin.token)).status, 200);

// Money routes must reject a missing/incorrect confirmation phrase even for a real admin.
expect(
  "admin  /send  no confirm",
  (await probe("/admin/send", admin.token, {
    method: "POST",
    body: JSON.stringify({ to: admin.address, amount: 1 }),
  })).status,
  400,
);
expect(
  "admin  /send  wrong confirm",
  (await probe("/admin/send", admin.token, {
    method: "POST",
    body: JSON.stringify({ to: admin.address, amount: 1, confirm: "yes" }),
  })).status,
  400,
);
// The route keys on the user's UUID, not their address.
const userList = await probe("/admin/users", admin.token);
const targetId = (userList.body?.users ?? []).find(
  (u: any) => String(u.address ?? "").toLowerCase() === user.address,
)?.id;
if (!targetId) throw new Error("test user not found in /admin/users");

expect(
  "admin  /balance over cap",
  (await probe(`/admin/users/${targetId}/balance`, admin.token, {
    method: "POST",
    body: JSON.stringify({ balance: 99_999_999, confirm: "SET BALANCE", reason: "test" }),
  })).status,
  400,
);
expect(
  "admin  /balance no reason",
  (await probe(`/admin/users/${targetId}/balance`, admin.token, {
    method: "POST",
    body: JSON.stringify({ balance: 10, confirm: "SET BALANCE" }),
  })).status,
  400,
);
expect(
  "admin  /balance negative",
  (await probe(`/admin/users/${targetId}/balance`, admin.token, {
    method: "POST",
    body: JSON.stringify({ balance: -5, confirm: "SET BALANCE", reason: "test" }),
  })).status,
  400,
);

// Non-admin must not be able to move money regardless of a correct confirmation phrase.
expect(
  "NON-admin  /send  correct confirm",
  (await probe("/admin/send", user.token, {
    method: "POST",
    body: JSON.stringify({ to: user.address, amount: 1, confirm: "SEND FUNDS" }),
  })).status,
  403,
);

const overview = await probe("/admin/overview", admin.token);
console.log("\noverview keys:", Object.keys(overview.body ?? {}).join(", "));
console.log("solvency:", JSON.stringify(overview.body?.solvency));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
