// EIP-1193 wallet provider (MetaMask, Rabby, Coinbase Wallet, …) on Robinhood Chain.
//
// Deliberately dependency-free, like the Phantom version it replaces. wagmi would pull in a
// pinned TanStack Query, a connectors graph and a provider tree to serve a ~100 line file that
// needs connect, sign and two listeners — and the app already has its own auth context.
// Revisit only if WalletConnect / multi-connector is needed.

import {
  ROBINHOOD_MAINNET,
  ROBINHOOD_TESTNET,
  buildAuthMessage,
  normalizeAddress,
  toAddChainParams,
  type ChainConfig,
} from "shared/chain";

export interface WalletState {
  connected: boolean;
  address: string | null;
  connecting: boolean;
  wrongChain: boolean;
}

const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_EVM_CHAIN_ID ?? String(ROBINHOOD_TESTNET.chainId));

export function targetChain(): ChainConfig {
  return CHAIN_ID === ROBINHOOD_MAINNET.chainId ? ROBINHOOD_MAINNET : ROBINHOOD_TESTNET;
}

function provider(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

export function isWalletInstalled(): boolean {
  return !!provider();
}

export async function connectWallet(): Promise<string> {
  const eth = provider();
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask or a compatible wallet.");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No account authorised");
  await ensureChain();
  // Wallets disagree on whether this comes back checksummed. Normalise once, here.
  return normalizeAddress(accounts[0]);
}

export async function disconnectWallet(): Promise<void> {
  // EIP-1193 has no disconnect — the dapp simply forgets the account, and revoking access is a
  // wallet-side action. Clearing local auth state is the caller's job.
}

export async function getChainId(): Promise<number | null> {
  const eth = provider();
  if (!eth) return null;
  try {
    return parseInt(await eth.request({ method: "eth_chainId" }), 16);
  } catch {
    return null;
  }
}

export async function isOnTargetChain(): Promise<boolean> {
  return (await getChainId()) === targetChain().chainId;
}

/**
 * Switch to the target chain, adding it first if the wallet doesn't know it.
 * 4902 = "Unrecognized chain ID". Some wallets bury the code a level or two down.
 */
export async function ensureChain(): Promise<void> {
  const eth = provider();
  if (!eth) throw new Error("Wallet not connected");
  const cfg = targetChain();
  const hexId = `0x${cfg.chainId.toString(16)}`; // 46630 -> 0xb626, 4663 -> 0x1237

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code ?? err?.data?.code;
    if (code !== 4902) throw err;
  }

  await eth.request({ method: "wallet_addEthereumChain", params: [toAddChainParams(cfg)] });
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
}

/**
 * Sign the auth message. Three differences from the Phantom version worth noting:
 *   - personal_sign takes params as [message, address] — the REVERSE of eth_sign
 *   - the signature is a 0x hex string, not base64 (and no Buffer polyfill needed)
 *   - the message carries chainId, so a testnet signature cannot be replayed on mainnet
 */
export async function signAuthMessage(address: string): Promise<{ message: string; signature: string }> {
  const eth = provider();
  if (!eth) throw new Error("Wallet not connected");
  const addr = normalizeAddress(address);
  const message = buildAuthMessage(addr, targetChain().chainId, Date.now());
  const signature: string = await eth.request({ method: "personal_sign", params: [message, addr] });
  return { message, signature };
}

/** Fires with an ARRAY (empty = disconnected), not a Phantom pubkey object. */
export function onAccountChange(callback: (address: string | null) => void): () => void {
  const eth = provider();
  if (!eth?.on) return () => {};
  const handler = (accounts: string[]) =>
    callback(accounts?.length ? normalizeAddress(accounts[0]) : null);
  eth.on("accountsChanged", handler);
  return () => { try { eth.removeListener("accountsChanged", handler); } catch {} };
}

/** New UX state the Solana rail never had: the user can be connected but on the wrong network. */
export function onChainChange(callback: (chainId: number, onTarget: boolean) => void): () => void {
  const eth = provider();
  if (!eth?.on) return () => {};
  const handler = (hexId: string) => {
    const id = parseInt(hexId, 16);
    callback(id, id === targetChain().chainId);
  };
  eth.on("chainChanged", handler);
  return () => { try { eth.removeListener("chainChanged", handler); } catch {} };
}
