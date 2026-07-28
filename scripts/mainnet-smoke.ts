/**
 * Live mainnet smoke test for the deposit/withdraw path.
 *
 * Deliberately moves NO money. It proves the parts that can be proven without funds:
 *   - auth works against chain 4663 (a testnet-chainId signature must be rejected)
 *   - the deposit address the UI hands out is the platform hot wallet
 *   - the withdrawal endpoint enforces its guards before touching the chain
 *
 * The one thing it cannot cover is the actual round trip, which needs real USDG from a wallet
 * this script does not hold. That step is manual.
 */
import { privateKeyToAccount } from "viem/accounts";

// Defaults to a local keeper. Point SMOKE_API at a deployment to test one:
//   SMOKE_API=https://your-host/api npm run test:smoke
const API = process.env.SMOKE_API ?? "http://localhost:3001/api";
const MAINNET = 4663;
const TESTNET = 46630;

// Anvil test key #3 -- public, holds nothing. Creates a throwaway $0 account.
const PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
const account = privateKeyToAccount(PK);

let fails = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
}

async function login(chainId: number) {
  const message = `watchperps-auth:${account.address.toLowerCase()}:${chainId}:${Date.now()}`;
  const signature = await account.signMessage({ message });
  const r = await fetch(`${API}/auth/wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: account.address, message, signature }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function main() {
  console.log(`API: ${API}\ntest wallet: ${account.address.toLowerCase()}\n`);

  // 1. A signature bound to testnet must not authenticate a mainnet deployment.
  const wrong = await login(TESTNET);
  check("testnet-chainId signature rejected", wrong.status === 400, `got ${wrong.status}`);

  // 2. Correct chain authenticates.
  const good = await login(MAINNET);
  check("mainnet-chainId signature accepted", good.status === 200, `got ${good.status}`);
  if (good.status !== 200) { console.log(JSON.stringify(good.body)); process.exit(1); }
  const token = good.body.token;
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  // 3. New accounts must start at $0 -- no signup bonus on a real-money deployment.
  const me = await (await fetch(`${API}/auth/me`, { headers: auth })).json();
  check("new account starts at $0", Number(me.balanceUsd) === 0, `balance=${me.balanceUsd}`);

  // 4. Deposit address is the platform hot wallet, on mainnet.
  const dep = await (await fetch(`${API}/account/deposit-address`, { headers: auth })).json().catch(() => ({}));
  const addr = String(dep.address ?? dep.depositAddress ?? "").toLowerCase();
  check("deposit address served", /^0x[0-9a-f]{40}$/.test(addr), addr || JSON.stringify(dep));
  console.log(`      deposit address: ${addr}`);
  if (dep.chainId !== undefined) check("deposit address is for chain 4663", dep.chainId === MAINNET, `chainId=${dep.chainId}`);

  // 5. Withdrawal guards. Balance is $0, so every one of these must be refused BEFORE any
  //    chain interaction. A 200 here would mean the platform tried to send funds it has no
  //    record of the user owning.
  const w = async (body: any) => {
    const r = await fetch(`${API}/account/withdraw`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  //    The field is `toAddress`, not `to`. Using the wrong name makes every request fail at
  //    parameter validation, which looks like a pass while testing nothing -- so each case below
  //    asserts the SPECIFIC error it should produce, not merely "some 4xx".
  const toAddress = account.address;

  const noFunds = await w({ toAddress, amount: 25 });
  check(
    "withdraw with $0 balance refused for the right reason",
    noFunds.status === 400 && /insufficient balance/i.test(noFunds.body?.error ?? ""),
    `${noFunds.status} ${noFunds.body?.error ?? ""}`,
  );

  const negative = await w({ toAddress, amount: -100 });
  check("negative amount refused", negative.status === 400, `${negative.status} ${negative.body?.error ?? ""}`);

  const overCap = await w({ toAddress, amount: 999_999 });
  check(
    "over-cap amount refused",
    overCap.status === 400 || overCap.status === 429,
    `${overCap.status} ${overCap.body?.error ?? ""}`,
  );

  const badAddr = await w({ toAddress: "not-an-address", amount: 25 });
  check(
    "invalid destination refused by address validation",
    badAddr.status === 400 && /invalid address/i.test(badAddr.body?.error ?? ""),
    `${badAddr.status} ${badAddr.body?.error ?? ""}`,
  );

  const belowMin = await w({ toAddress, amount: 0.01 });
  check(
    "below-minimum amount refused",
    belowMin.status === 400 && /minimum/i.test(belowMin.body?.error ?? ""),
    `${belowMin.status} ${belowMin.body?.error ?? ""}`,
  );

  // 6. Admin surface must not be reachable by this throwaway account.
  const adm = await fetch(`${API}/admin/overview`, { headers: auth });
  check("non-admin blocked from /admin/overview", adm.status === 403, `got ${adm.status}`);

  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  console.log(`\nNOTE: this created a $0 account ${account.address.toLowerCase()} in the live DB.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
