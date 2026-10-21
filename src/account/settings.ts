import { DEFAULT_GUARDRAILS, type Guardrails, type Holdings } from "../engine/policy";

/** Shared between browser and server. The server always re-clamps before using anything. */
export interface Settings {
  btc: number;
  eth: number;
  maxRatio: number;
  maxUsd: number;
  lev: number;
  lead: number;
  hold: number;
  aggr: number;
  live: boolean;
}

export const DEFAULT_SETTINGS: Settings = { btc: 0.2, eth: 3, maxRatio: 0.5, maxUsd: 5000, lev: 2, lead: 60, hold: 6, aggr: 1, live: false };

export const LIMITS = {
  btc: [0, 10_000],
  eth: [0, 100_000],
  maxRatio: [0, 1],
  maxUsd: [0, 1_000_000],
  lev: [1, 5],
  lead: [15, 240],
  hold: [1, 24],
  aggr: [0, 1.5],
} as const satisfies Record<Exclude<keyof Settings, "live">, readonly [number, number]>;

export function clampSettings(raw: Partial<Record<keyof Settings, unknown>> | null | undefined, base: Settings = DEFAULT_SETTINGS): Settings {
  const out = { ...base };
  if (!raw) return out;
  for (const k of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "" && Number.isFinite(v)) {
      const [lo, hi] = LIMITS[k];
      out[k] = Math.min(hi, Math.max(lo, v));
    }
  }
  if (typeof raw.live === "boolean") out.live = raw.live;
  out.lev = Math.round(out.lev);
  return out;
}

export function toGuardrails(s: Settings): Guardrails {
  return {
    ...DEFAULT_GUARDRAILS,
    maxHedgeRatio: s.maxRatio,
    maxNotionalUsd: s.maxUsd,
    maxLeverage: s.lev,
    leadMinutes: s.lead,
    maxHoldHours: s.hold,
    aggressiveness: s.aggr,
    dryRun: !s.live,
  };
}

export interface WalletSync {
  btcAddress?: string;
  ethAddress?: string;
  btc?: number | null; // last read balance, BTC
  eth?: number | null; // last read balance, ETH
  at?: number;
  error?: string;
}

/** Synced balances replace typed ones for that coin; typed amounts cover everything else (exchanges, cold storage…). */
export function effectiveHoldings(s: Settings, sync?: WalletSync): Holdings & { source: { BTC: "typed" | "synced"; ETH: "typed" | "synced" } } {
  const btcSynced = Boolean(sync?.btcAddress && sync.btc != null);
  const ethSynced = Boolean(sync?.ethAddress && sync.eth != null);
  return {
    BTC: btcSynced ? sync!.btc! : s.btc,
    ETH: ethSynced ? sync!.eth! : s.eth,
    source: { BTC: btcSynced ? "synced" : "typed", ETH: ethSynced ? "synced" : "typed" },
  };
}

export const CONFIRM_EVERY_MS = 7 * 86_400_000;
export const SYNC_FRESH_MS = 24 * 3_600_000;

/**
 * Holdings are trusted when the user confirmed them in the last 7 days, or every coin they hold
 * is synced from a wallet within the last 24 hours. Live hedges only open on trusted holdings,
 * so a hedge can't outgrow coins the user has sold.
 */
export function holdingsTrusted(args: { settings: Settings; sync?: WalletSync; confirmedAt?: number; now?: number }): boolean {
  const now = args.now ?? Date.now();
  if (args.confirmedAt && now - args.confirmedAt < CONFIRM_EVERY_MS) return true;
  const h = effectiveHoldings(args.settings, args.sync);
  const fresh = Boolean(args.sync?.at && now - args.sync.at < SYNC_FRESH_MS);
  const btcOk = h.BTC === 0 || (h.source.BTC === "synced" && fresh);
  const ethOk = h.ETH === 0 || (h.source.ETH === "synced" && fresh);
  return btcOk && ethOk;
}
