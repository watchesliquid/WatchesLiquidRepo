// Robinhood Chain — an Arbitrum Orbit L2. EVM-equivalent, ETH gas, ~100ms blocks.
//
// Every value below was verified against the live RPCs (July 2026):
//   mainnet eth_chainId -> 0x1237 (4663), testnet -> 0xb626 (46630)
//   mainnet USDG 0x5fc5…d168: symbol "USDG", decimals 6
//   testnet USDG lives at a DIFFERENT address (0x915e…03ec), also symbol "USDG", decimals 6
// Decimals are still read on-chain at runtime rather than trusted from here — an 18-vs-6
// mistake is a 10^12x error in both directions, so it fails closed instead.

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  /** Canonical USDG (collateral). Chain-specific — the mainnet address does NOT exist on testnet. */
  usdgAddress: string;
  isTestnet: boolean;
}

export const ROBINHOOD_MAINNET: ChainConfig = {
  chainId: 4663,
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  usdgAddress: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  isTestnet: false,
};

export const ROBINHOOD_TESTNET: ChainConfig = {
  chainId: 46630,
  name: "Robinhood Chain Testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  usdgAddress: "0x915ef7c9f9f80a69e3be47a38ee0bb47607103ec",
  isTestnet: true,
};

export const CHAINS: Record<number, ChainConfig> = {
  [ROBINHOOD_MAINNET.chainId]: ROBINHOOD_MAINNET,
  [ROBINHOOD_TESTNET.chainId]: ROBINHOOD_TESTNET,
};

export function getChainById(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
}

/** ERC20 Transfer(address indexed from, address indexed to, uint256 value) */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ERC20_ABI = [
  {
    type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }],
  },
  {
    type: "function", name: "symbol", stateMutability: "view",
    inputs: [], outputs: [{ type: "string" }],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "transfer", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event", name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * Lowercase an address. EIP-55 checksummed and lowercase forms are the SAME address but
 * DIFFERENT strings, and === does not know that.
 *
 * This is not cosmetic. `users.find(u => u.public_key === addr)` with a case mismatch silently
 * creates a duplicate account with a fresh starting balance, and the deposit scanner (viem
 * returns checksummed) would then never match the stored key. Normalise at every boundary,
 * store lowercase, checksum only for display.
 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidAddressFormat(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function addressesEqual(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

/** `wallet_addEthereumChain` params. chainId must be hex, not decimal. */
export function toAddChainParams(cfg: ChainConfig) {
  return {
    chainId: `0x${cfg.chainId.toString(16)}`, // 4663 -> 0x1237, 46630 -> 0xb626
    chainName: cfg.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [cfg.rpcUrl],
    blockExplorerUrls: [cfg.explorerUrl],
  };
}

/** Auth message. Single line and ':'-delimited so `split(':').pop()` still lands on the
 *  timestamp, and chain-bound so a testnet signature cannot be replayed on mainnet. */
export const AUTH_PREFIX = "watchperps-auth";

export function buildAuthMessage(address: string, chainId: number, timestamp: number): string {
  return `${AUTH_PREFIX}:${normalizeAddress(address)}:${chainId}:${timestamp}`;
}

export function txUrl(cfg: ChainConfig, txHash: string): string {
  return `${cfg.explorerUrl}/tx/${txHash}`;
}

/** Blockscout's token page — holders, transfers and supply, which /address does not surface. */
export function tokenUrl(cfg: ChainConfig, address: string): string {
  return `${cfg.explorerUrl}/token/${address}`;
}
