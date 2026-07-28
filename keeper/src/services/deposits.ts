import { memDb, saveDb } from "../db/memory";
import { getChainConfig, getPlatformAddress, getBlockNumber, publicClient, fromUsdgUnits } from "./evm";
import { ERC20_ABI, normalizeAddress } from "shared/chain";
import type { Address } from "viem";

// Credit users who send USDG to the platform hot wallet.
//
// The Solana version issued getSignaturesForAddress PER USER and then an N+1 getTransaction per
// signature — 12 users meant 12 identical RPC calls a minute. Here the recipient is a topic on
// the Transfer event, so the node filters server-side and one eth_getLogs covers every user.

const CONFIRMATIONS = parseInt(process.env.EVM_CONFIRMATIONS ?? "20");
const CHUNK = parseInt(process.env.EVM_SCAN_CHUNK_BLOCKS ?? "2000");
const START_BLOCK = process.env.EVM_START_BLOCK ? parseInt(process.env.EVM_START_BLOCK) : null;

// ~100ms blocks => ~600 blocks per 60s tick, ~864k/day. 2000-block chunks sit well inside the
// usual 10k eth_getLogs cap, and a topic-filtered USDG query returns few logs so response size
// never binds. Cap the catch-up so a long outage backfills over several ticks instead of
// hammering the RPC in one burst.
const MAX_CHUNKS_PER_TICK = 50;

/**
 * The cursor id is scoped to the chain, NOT a bare "evm".
 *
 * Block heights are per-chain and unrelated. Testnet was ~94.1M blocks deep while mainnet was at
 * ~21.2M, so a shared cursor carried across a chain switch resumes from a height far beyond the
 * new chain's head. `from >= safeHead` then returns early on every tick: the scanner looks alive,
 * logs nothing, and silently misses every deposit forever. Keying on chainId makes switching
 * chains a cold start instead, which is the correct behaviour.
 */
function cursorId(): string {
  return `evm:${getChainConfig().chainId}`;
}

function cursor(): { id: string; lastScannedBlock: number } | undefined {
  return memDb.chainState.find((c: any) => c.id === cursorId());
}

function setCursor(block: number): void {
  const c = cursor();
  if (c) c.lastScannedBlock = block;
  // memory.ts's loadDb only restores keys present in the memDb literal — `chainState` is listed
  // there, so this survives a restart. Without that the cursor would silently reset to head on
  // every boot and skip every deposit made while the keeper was down.
  else memDb.chainState.push({ id: cursorId(), lastScannedBlock: block });
}

export async function scanDeposits(): Promise<{ credited: number; scannedTo: number }> {
  const cfg = getChainConfig();
  const platform = getPlatformAddress();

  const head = await getBlockNumber();
  // Soft (sequencer) confirmation is sub-second on an Orbit chain; L1 finality is minutes to
  // hours and unusable for a trading UX. 20 blocks ~= 2s here — imperceptible, and env-tunable
  // if the sequencer ever misbehaves.
  const safeHead = head - CONFIRMATIONS;
  if (safeHead <= 0) return { credited: 0, scannedTo: 0 };

  let from = cursor()?.lastScannedBlock;
  if (from === undefined) {
    // Never scan from block 0 — testnet is already ~90M blocks deep.
    from = START_BLOCK ?? safeHead;
    setCursor(from);
    saveDb();
    console.log(`[deposits] cold start on ${cfg.name} (${cfg.chainId}), cursor set to block ${from}`);
  }
  if (from >= safeHead) return { credited: 0, scannedTo: from };

  // Rebuilt each tick — users register between ticks.
  const byAddress = new Map<string, any>();
  for (const u of memDb.users) {
    if (u.public_key) byAddress.set(normalizeAddress(u.public_key), u);
  }

  let credited = 0;
  let chunks = 0;

  while (from < safeHead && chunks < MAX_CHUNKS_PER_TICK) {
    const to = Math.min(from + CHUNK, safeHead);

    const logs = await publicClient.getContractEvents({
      address: cfg.usdgAddress as Address,
      abi: ERC20_ABI,
      eventName: "Transfer",
      args: { to: platform as Address }, // server-side topic2 filter
      fromBlock: BigInt(from + 1),
      toBlock: BigInt(to),
    });

    for (const log of logs) {
      const sender = log.args?.from ? normalizeAddress(log.args.from as string) : null;
      const value = log.args?.value as bigint | undefined;
      if (!sender || value === undefined) continue;

      const user = byAddress.get(sender);
      // A deposit from an exchange or a contract wallet has from !== the user's auth address
      // and cannot be attributed. Same limitation as the Solana rail, but far likelier on EVM
      // where people withdraw straight from a CEX. Surface these rather than lose them.
      if (!user) {
        // PERSIST these, don't just log them. A console line is unrecoverable: real money has
        // arrived in the platform wallet and the only record of who sent it scrolls away. Stored
        // as a claimable row so an admin can attribute it to the right account later. The key is
        // the same txHash:logIndex used for crediting, so a row can never be claimed twice.
        const key = `${log.transactionHash}:${log.logIndex}`;
        const amount = await fromUsdgUnits(value);
        if (!memDb.unattributedDeposits.some((d: any) => d.key === key)) {
          memDb.unattributedDeposits.push({
            key,
            from: sender,
            amount,
            txHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            blockNumber: Number(log.blockNumber),
            observedAt: new Date().toISOString(),
            status: "unclaimed",
          });
        }
        console.warn(`[deposits] unattributed ${amount} USDG from ${sender} tx ${log.transactionHash}`);
        continue;
      }

      // txHash alone is NOT enough: one tx can carry several USDG transfers to the platform
      // (batch/multicall), and keying on it would credit the first and silently drop the rest.
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (!user.credited_txs) user.credited_txs = [];
      if (user.credited_txs.includes(key)) continue;

      const amount = await fromUsdgUnits(value);
      // 1 USDG == 1 USD, so crediting 1:1 is correct here. The Solana rail did the same thing
      // with SOL, which was a real bug — it credited 1 SOL as $1.
      user.balance_usd = String(Number(user.balance_usd) + amount);
      user.credited_txs.push(key);
      credited++;
      console.log(`[deposits] +${amount.toFixed(2)} USDG -> ${sender.slice(0, 10)}… (${key.slice(0, 20)}…)`);
    }

    // Order matters: credit, persist, THEN advance. Crash before the save and the chunk is
    // rescanned and dedupe absorbs it; crash after and the chunk is never revisited.
    if (logs.length > 0) saveDb();
    setCursor(to);
    saveDb();

    from = to;
    chunks++;
  }

  return { credited, scannedTo: from };
}
