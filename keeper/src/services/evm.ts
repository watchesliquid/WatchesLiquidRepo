// Robinhood Chain (EVM) payment rail. Replaces the Solana rail.
//
// Deliberately a clean break rather than a shim over the old names: sendSol -> sendUsdg changes
// what the return value MEANS (base58 signature -> hex txHash) and how it fails (see the
// receipt note below). A sendSol-shaped wrapper would invite callers to keep the Solana mental
// model, which is exactly the bug we would be shipping.

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  getContract,
  parseUnits,
  formatUnits,
  verifyMessage,
  defineChain,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ERC20_ABI,
  getChainById,
  isValidAddressFormat,
  normalizeAddress,
  ROBINHOOD_TESTNET,
  type ChainConfig,
} from "shared/chain";

const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID ?? String(ROBINHOOD_TESTNET.chainId));
const cfgBase = getChainById(CHAIN_ID);
if (!cfgBase) throw new Error(`Unknown EVM_CHAIN_ID ${CHAIN_ID} — expected 4663 or 46630`);

// Env overrides let you point at a private RPC or a mock token without a code change.
const cfg: ChainConfig = {
  ...cfgBase,
  rpcUrl: process.env.EVM_RPC_URL || cfgBase.rpcUrl,
  usdgAddress: normalizeAddress(process.env.USDG_ADDRESS || cfgBase.usdgAddress),
};

/**
 * Every RPC endpoint to try, in order. First is primary; the rest are failover.
 *
 * There was only ever one. A single unreachable endpoint stopped deposit scanning, withdrawal
 * reconciliation and the reserves figure at once — and because a failed scan is safe by design
 * (the cursor only advances on success), the failure was silent: the keeper looked alive and
 * simply stopped seeing deposits.
 *
 * Set EVM_RPC_FALLBACKS to a comma-separated list. Duplicates of the primary are dropped so a
 * copy-pasted value cannot produce a "fallback" that fails with it.
 */
const RPC_URLS: string[] = (() => {
  const extra = (process.env.EVM_RPC_FALLBACKS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return [...new Set([cfg.rpcUrl, ...extra])];
})();

export function getRpcUrls(): string[] {
  return [...RPC_URLS];
}

const PLATFORM_KEY = process.env.PLATFORM_WALLET_KEY ?? "";

export function getChainConfig(): ChainConfig {
  return cfg;
}

const chain = defineChain({
  id: cfg.chainId,
  name: cfg.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: "Explorer", url: cfg.explorerUrl } },
  testnet: cfg.isTestnet,
});

// http() only — never webSocket(). The ws transport drags in optional native peers
// (bufferutil, utf-8-validate) that the single-file esbuild bundle cannot resolve.
//
// fallback() moves to the next endpoint when one errors, and `rank: false` keeps them in the
// order given rather than reordering by observed latency — the primary is primary because an
// operator said so, and silent reordering makes "which node answered?" unanswerable during an
// incident. With one URL configured this behaves exactly as the single transport did.
function transport() {
  return fallback(
    RPC_URLS.map((url) => http(url, { retryCount: 2, timeout: 10_000 })),
    { rank: false },
  );
}

export const publicClient = createPublicClient({ chain, transport: transport() });

/**
 * Confirm every configured endpoint really serves the chain we think it does.
 *
 * A fallback pointing at the wrong network is worse than having no fallback: reads would silently
 * resolve against another chain the moment the primary hiccups, so the deposit scanner would walk
 * a foreign block height and credit nothing while looking healthy. The USDG contract address does
 * not even exist there.
 *
 * Fails closed, like getUsdgDecimals: a mismatch throws at boot rather than being discovered by a
 * missing deposit. Called from index.ts before the scan loop starts.
 */
export async function verifyRpcEndpoints(): Promise<void> {
  for (const url of RPC_URLS) {
    const probe = createPublicClient({ chain, transport: http(url, { retryCount: 1, timeout: 10_000 }) });
    let id: number;
    try {
      id = await probe.getChainId();
    } catch (err) {
      // Unreachable is not fatal when it is a spare — that is what a spare is for. A dead
      // PRIMARY is also survivable now, which is the entire point of the list.
      console.warn(`[evm] RPC unreachable at boot: ${url} (${(err as Error).message})`);
      continue;
    }
    if (id !== cfg.chainId) {
      throw new Error(
        `RPC ${url} reports chain ${id}, expected ${cfg.chainId} (${cfg.name}). Refusing to ` +
          "start: a failover onto the wrong chain scans foreign blocks and credits nothing.",
      );
    }
  }
  console.log(`[evm] ${RPC_URLS.length} RPC endpoint(s) verified on chain ${cfg.chainId}`);
}

let _account: ReturnType<typeof privateKeyToAccount> | null = null;
function account() {
  if (_account) return _account;
  if (!PLATFORM_KEY || PLATFORM_KEY.includes("YOUR_KEY")) {
    throw new Error("PLATFORM_WALLET_KEY not configured");
  }
  const hex = (PLATFORM_KEY.startsWith("0x") ? PLATFORM_KEY : `0x${PLATFORM_KEY}`) as `0x${string}`;
  _account = privateKeyToAccount(hex);
  return _account;
}

// Same failover as reads. viem checks the chain id before signing, so a wrong-chain endpoint
// throws here rather than broadcasting a transfer onto the wrong network.
function walletClient() {
  return createWalletClient({ account: account(), chain, transport: transport() });
}

const usdg = () =>
  getContract({ address: cfg.usdgAddress as Address, abi: ERC20_ABI, client: publicClient });

// ── Identity ──

/** Platform hot wallet address, lowercased. */
export function getPlatformAddress(): string {
  return normalizeAddress(account().address);
}

export function isRpcConfigured(): boolean {
  return !!cfg.rpcUrl;
}

export function isPlatformConfigured(): boolean {
  try {
    account();
    return true;
  } catch {
    return false;
  }
}

export function isValidAddress(address: string): boolean {
  return isValidAddressFormat(address);
}

// ── Signature verification ──

/**
 * Async, unlike the ed25519 version — viem's verifyMessage may hit the chain to support
 * EIP-1271/6492 smart-contract wallets, which a plain ecrecover + compare would silently
 * reject. Handles the EIP-191 prefixing too.
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    if (!isValidAddressFormat(address)) return false;
    return await verifyMessage({
      address: address as Address,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

// ── Decimals: read once, fail closed ──

let _decimals: number | null = null;

/**
 * USDG is 6 decimals on both Robinhood mainnet and testnet (verified), but this is read from
 * the contract rather than hardcoded. Never falls back to a default: guessing wrong is a
 * 10^12x error in whichever direction hurts most.
 */
export async function getUsdgDecimals(): Promise<number> {
  if (_decimals !== null) return _decimals;
  const d = await usdg().read.decimals();
  const n = Number(d);
  if (!Number.isInteger(n) || n < 0 || n > 36) {
    throw new Error(`Refusing to use implausible USDG decimals: ${d}`);
  }
  _decimals = n;
  return n;
}

export async function toUsdgUnits(amount: number): Promise<bigint> {
  return parseUnits(amount.toFixed(await getUsdgDecimals()), await getUsdgDecimals());
}

export async function fromUsdgUnits(raw: bigint): Promise<number> {
  return Number(formatUnits(raw, await getUsdgDecimals()));
}

// ── Balances ──

export async function getUsdgBalance(address: string): Promise<number> {
  if (!isValidAddressFormat(address)) return 0;
  const raw = await usdg().read.balanceOf([address as Address]);
  return fromUsdgUnits(raw as bigint);
}

/**
 * Native ETH balance. Gas on Robinhood Chain is ETH, NOT USDG — a new, silent operational
 * dependency the Solana rail never had (there SOL was both gas and the asset, so the
 * requirement satisfied itself). If this hits zero every withdrawal fails.
 */
export async function getGasBalance(address: string): Promise<number> {
  if (!isValidAddressFormat(address)) return 0;
  const wei = await publicClient.getBalance({ address: address as Address });
  return Number(formatUnits(wei, 18));
}

export async function getBlockNumber(): Promise<number> {
  return Number(await publicClient.getBlockNumber());
}

// ── Withdrawals ──

/**
 * Serialised send queue with a locally tracked nonce.
 *
 * EVM transactions from one account are strictly nonce-ordered; Solana had no such constraint.
 * account.ts's per-user `_withdrawing` flag does NOT protect against this — two DIFFERENT users
 * withdrawing at once would both read the same pending nonce and one tx would silently replace
 * the other. Both locks are needed: this one protects the platform wallet, that one stops a
 * single user double-spending their own balance.
 *
 * This is in-process, so the API must stay at ONE pm2 instance. Cluster mode breaks it.
 */
let queue: Promise<unknown> = Promise.resolve();
let nextNonce: number | null = null;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export interface SendResult {
  txHash: string;
  status: "success" | "reverted";
}

/**
 * Transfer USDG from the platform wallet. Returns the txHash AND the receipt status.
 *
 * The status matters: Solana's sendAndConfirmTransaction THREW on failure, but viem's
 * waitForTransactionReceipt does NOT — a tx that mines and reverts resolves normally with
 * status "reverted". Porting the old try/catch shape verbatim would treat a reverted transfer
 * as success: balance deducted, no funds sent, txHash recorded. Callers must check status.
 *
 * `onBroadcast` fires the instant the hash exists and BEFORE the receipt is awaited, so a caller
 * can make it durable first. That gap is not theoretical: waiting for a receipt takes seconds,
 * and a crash inside it left a `pending` withdrawal with no txHash — which the reconciler reads
 * as "never broadcast" and refunds, while the transfer is confirming on-chain. The callback is
 * awaited; if persisting the hash throws, the send fails loudly rather than proceeding with an
 * unrecorded transaction in flight.
 */
export async function sendUsdg(
  to: string,
  amount: number,
  onBroadcast?: (txHash: string) => void | Promise<void>,
): Promise<SendResult> {
  if (!isValidAddressFormat(to)) throw new Error("Invalid recipient address");
  if (!(amount > 0)) throw new Error("Amount must be positive");

  const value = await toUsdgUnits(amount);

  return enqueue(async () => {
    const acct = account();
    if (nextNonce === null) {
      nextNonce = await publicClient.getTransactionCount({ address: acct.address, blockTag: "pending" });
    }
    const nonce = nextNonce;

    let txHash: `0x${string}`;
    try {
      txHash = await walletClient().writeContract({
        address: cfg.usdgAddress as Address,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to as Address, value],
        nonce,
      });
      nextNonce = nonce + 1;
    } catch (err) {
      // Broadcast never landed — resync from chain rather than trusting the local counter.
      nextNonce = null;
      throw err;
    }

    // Durable before the wait, not after. Everything below this line can take seconds.
    if (onBroadcast) await onBroadcast(txHash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    return { txHash, status: receipt.status === "success" ? "success" : "reverted" };
  });
}
