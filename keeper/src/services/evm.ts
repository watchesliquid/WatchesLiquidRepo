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

const PLATFORM_KEY = process.env.PLATFORM_WALLET_KEY ?? "";

export function getChainConfig(): ChainConfig {
  return cfg;
}

const chain = defineChain({
  id: cfg.chainId,
  name: cfg.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
  blockExplorers: { default: { name: "Explorer", url: cfg.explorerUrl } },
  testnet: cfg.isTestnet,
});

// http() only — never webSocket(). The ws transport drags in optional native peers
// (bufferutil, utf-8-validate) that the single-file esbuild bundle cannot resolve.
export const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

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

function walletClient() {
  return createWalletClient({ account: account(), chain, transport: http(cfg.rpcUrl) });
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
 */
export async function sendUsdg(to: string, amount: number): Promise<SendResult> {
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

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    return { txHash, status: receipt.status === "success" ? "success" : "reverted" };
  });
}
