/**
 * The WL token — one source of truth for the contract address shown on the site.
 *
 * Verified on-chain against Robinhood Chain mainnet (chain 4663) on 2026-08-04 before it was
 * published: the address holds 5274 bytes of bytecode and answers name "Watches Liquid",
 * symbol "WL", decimals 18, totalSupply 1,000,000,000. Re-verify with those four calls if it is
 * ever changed — a contract address on a public site is a thing people paste into a swap, and a
 * wrong one costs whoever trusts it real money.
 *
 * Stored EIP-55 checksummed on purpose. Checksummed and lowercase are the same address but
 * different strings; the mixed case is a self-check, so a single mistyped character makes the
 * address fail validation in most wallets instead of silently resolving somewhere else.
 */
export const WL_TOKEN = {
  address: "0x5B0ecD8e3379dCFE335826A6259c2CDf8D01eef6",
  symbol: "WL",
  name: "Watches Liquid",
  decimals: 18,
} as const;

/** Short form for tight layouts — never for anything a user is meant to copy. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
