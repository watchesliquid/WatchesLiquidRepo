/**
 * Regression test for the withdraw/open-position TOCTOU.
 *
 * POST /account/withdraw awaits an RPC round-trip between checking the balance and deducting it.
 * POST /positions/open is synchronous, so it completes inside that window using the same balance.
 * Firing both at once let a user withdraw their balance on-chain AND open a position with it,
 * driving balance_usd negative.
 *
 * The invariant this asserts is simple and does not depend on which request wins the race:
 *
 *     balance_usd must never end up negative.
 *
 * Run against a LOCAL keeper only. It needs a funded balance, so it uses the admin balance-set
 * route to stage one; never point it at production.
 */
import { privateKeyToAccount } from "viem/accounts";
import { buildAuthMessage } from "shared/chain";

const API = process.env.RACE_API ?? "http://localhost:3001/api";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID ?? 46630);

const ADMIN_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const VICTIM_PK = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as const;

async function login(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  const message = buildAuthMessage(account.address, CHAIN_ID, Date.now());
  const signature = await account.signMessage({ message });
  const r = await fetch(`${API}/auth/wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: account.address, message, signature }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`login ${r.status}: ${JSON.stringify(b)}`);
  return { token: b.token as string, address: account.address.toLowerCase(), id: b.user?.id as string };
}

async function main() {
  const admin = await login(ADMIN_PK);
  const victim = await login(VICTIM_PK);
  const H = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

  // Stage a balance via the admin route.
  const users = await (await fetch(`${API}/admin/users`, { headers: H(admin.token) })).json();
  const row = (users.users ?? []).find((u: any) => String(u.address).toLowerCase() === victim.address);
  if (!row) throw new Error("victim not found via /admin/users — is ADMIN_ADDRESSES set?");

  const STAKE = 500;
  const set = await fetch(`${API}/admin/users/${row.id}/balance`, {
    method: "POST", headers: H(admin.token),
    body: JSON.stringify({ balance: STAKE, confirm: "SET BALANCE", reason: "race regression test" }),
  });
  if (!set.ok) throw new Error(`balance set failed: ${set.status} ${await set.text()}`);

  // The field is `marketId`, not `id`. Getting this wrong makes /positions/open return
  // "marketId, direction, size, leverage required" — a 400 that the race assertion below would
  // happily read as "the open was refused", i.e. a green test that exercised nothing.
  const markets = await (await fetch(`${API}/markets`)).json();
  const marketId = markets.markets?.[0]?.marketId;
  if (!marketId) throw new Error(`could not resolve a marketId from /markets: ${JSON.stringify(markets).slice(0, 200)}`);

  // Fire both at the same tick. Withdraw awaits an RPC; open does not.
  const [wRes, pRes] = await Promise.allSettled([
    fetch(`${API}/account/withdraw`, {
      method: "POST", headers: H(victim.token),
      body: JSON.stringify({ toAddress: victim.address, amount: STAKE }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    fetch(`${API}/positions/open`, {
      method: "POST", headers: H(victim.token),
      body: JSON.stringify({ marketId, direction: "long", size: STAKE, leverage: 1 }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  ]);

  const val = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value : null);
  const w = val(wRes), p = val(pRes);
  console.log(`  withdraw     : ${w?.status} ${w?.body?.error ?? "ok"}`);
  console.log(`  open position: ${p?.status} ${p?.body?.error ?? "ok"}`);

  const me = await (await fetch(`${API}/auth/me`, { headers: H(victim.token) })).json();
  const balance = Number(me.balanceUsd);
  const positions = await (await fetch(`${API}/positions`, { headers: H(victim.token) })).json();
  const margin = (positions.positions ?? []).reduce((s: number, x: any) => s + Number(x.collateral || 0), 0);

  console.log(`\n  staked:            $${STAKE}`);
  console.log(`  final balance:     $${balance}`);
  console.log(`  margin in position:$${margin}`);
  console.log(`  total accounted:   $${balance + margin}`);

  let fail = 0;

  // Invariant 1: the stake cannot be spent twice, whoever wins the race.
  if (balance < 0) { console.log("\nFAIL  balance went NEGATIVE"); fail++; }
  if (balance + margin > STAKE + 0.01) {
    console.log(`\nFAIL  accounted $${balance + margin} exceeds the $${STAKE} staked — funds were duplicated`);
    fail++;
  }

  // Invariant 2: the withdrawal reserves before it awaits, so the racing open must be refused.
  // This is what actually distinguishes the fixed code: pre-fix, `open` succeeded because the
  // deduction had not happened yet.
  const openErr = String(p?.body?.error ?? "");
  if (p?.status === 200) {
    console.log("\nFAIL  position opened against funds already committed to an in-flight withdrawal");
    fail++;
  } else if (/required|not found|not active/i.test(openErr)) {
    // A malformed request is not evidence of anything. Fail loudly rather than score it as a pass.
    console.log(`\nFAIL  the open request was malformed, so the race was never exercised: "${openErr}"`);
    fail++;
  } else {
    console.log(`\n  open correctly refused: "${openErr}"`);
  }

  console.log(fail === 0 ? "\nPASS  no double-spend" : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
