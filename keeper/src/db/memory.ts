// In-memory DB with persistent JSON file backup
// Data survives restarts automatically

import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.join(process.cwd(), "data", "watchperps.json");

// In-memory state.
// NOTE: loadDb only restores keys that exist in this literal — anything not listed here is
// silently dropped on restart. Add new collections here or they will not persist.
export const memDb: Record<string, any[]> = {
  users: [],
  markets: [],
  positions: [],
  prices: [],
  candles: [],
  trades: [],
  fundingPayments: [],
  marketStats: [],
  chainState: [],
  /** Append-only record of every admin action. Never written by normal user flows. */
  auditLog: [],
  /** On-chain deposits whose sender matches no user — claimable by an admin, never lost. */
  unattributedDeposits: [],
  /** Operational switches set from the admin panel (withdrawals paused, markets halted). */
  adminState: [],
};

// Load from disk on startup
export function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      const data = JSON.parse(raw);
      for (const key of Object.keys(memDb)) {
        if (data[key]) memDb[key] = data[key];
      }
      // `_withdrawing` is an in-process mutex held across the await in POST /account/withdraw.
      // saveDb() serialises the whole memDb, underscore fields included, so a restart while a
      // withdrawal was in flight persists the lock as `true` -- and nothing ever clears it. That
      // user then gets 429 "Withdrawal in progress" on every future attempt, permanently. The
      // process that held the lock is gone by definition, so the lock cannot still be valid.
      let unlocked = 0;
      for (const u of memDb.users as any[]) {
        if (u._withdrawing) { delete u._withdrawing; unlocked++; }
      }
      if (unlocked > 0) console.warn(`[db] cleared ${unlocked} stale withdrawal lock(s) left by a restart`);

      console.log(`[db] Loaded from disk: ${memDb.users.length} users, ${memDb.positions.length} positions, ${memDb.trades.length} trades`);
      return true;
    }
  } catch (err) {
    console.error("[db] Failed to load, starting fresh:", (err as Error).message);
  }
  return false;
}

// Save to disk (debounced)
let saveTimer: NodeJS.Timeout | null = null;
export function saveDb() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = DB_PATH + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(memDb, null, 2), "utf-8");
      fs.renameSync(tmp, DB_PATH); // atomic write
    } catch (err) {
      console.error("[db] Failed to save:", (err as Error).message);
    }
  }, 200);
}

// Also auto-save every 10 seconds to catch direct array mutations
let autoSaveInterval: NodeJS.Timeout | null = null;
export function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(() => {
    saveDb();
  }, 10000);
}

export function memQuery(table: string) {
  if (!memDb[table]) memDb[table] = [];
  const rows = memDb[table];

  return {
    rows,

    insert(values: any) {
      const id = values.id ?? crypto.randomUUID();
      const row = { ...values, id };
      rows.push(row);
      saveDb();
      return {
        returning: () => [row],
      };
    },

    select(whereFn?: (row: any) => boolean) {
      const filtered = whereFn ? rows.filter(whereFn) : [...rows];
      return {
        orderBy: () => ({
          limit: (n: number) => {
            let result = [...filtered];
            if (n) result = result.slice(0, n);
            return result;
          },
        }),
        limit: (n: number) => filtered.slice(0, n),
      };
    },

    update(values: any, whereFn: (row: any) => boolean) {
      const updated: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (whereFn(rows[i])) {
          rows[i] = { ...rows[i], ...values };
          updated.push(rows[i]);
        }
      }
      saveDb();
      return { returning: () => updated };
    },

    delete(whereFn: (row: any) => boolean) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (whereFn(rows[i])) rows.splice(i, 1);
      }
      saveDb();
    },
  };
}

// Seed default markets on fresh start
import { MARKETS } from "shared/markets";

export function seedMemMarkets() {
  if (memDb.markets.length > 0) return;

  for (const m of MARKETS) {
    const price = m.basePrice;

    memDb.markets.push({
      id: m.id,
      name: m.name,
      category: m.category,
      reference_number: m.referenceNumber,
      ticker: m.ticker,
      brand: m.brand,
      image_url: m.imageUrl,
      index_price: String(price),
      mark_price: String(price),
      open_interest_long: "0",
      open_interest_short: "0",
      funding_rate: "0",
      last_funding_time: null,
      max_leverage: m.maxLeverage,
      min_position_size: String(m.minPositionSize),
      fee_rate: String(m.feeRate),
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }
  saveDb();
}
