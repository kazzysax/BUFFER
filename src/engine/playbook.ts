import type { MacroRelease } from "../sosovalue/client";
import { eventMeta, releaseTime } from "./events";

export interface Candle {
  t: number; // open time ms
  o: number;
  c: number;
}

export interface Sample {
  date: string;
  releaseAt: number;
  surprise: number | null; // actual − forecast
  surpriseZ: number | null;
  move: number; // signed return T−1h → T+4h
  absMove: number;
}

export interface Playbook {
  event: string;
  label: string;
  n: number;
  medianAbsMove: number;
  p90AbsMove: number;
  /** OLS slope of |move| on |surprise z| — "how much more does crypto move per 1σ of surprise". */
  surpriseSensitivity: number | null;
  /** Share of risk-off-direction surprises followed by a down move. Null if direction unknown. */
  riskOffHitRate: number | null;
  tier: Tier;
  lowSample: boolean;
  samples: Sample[];
}

export type Tier = "HIGH" | "MEDIUM" | "LOW";

export interface TierThresholds {
  high: number; // p90 abs move
  medium: number;
}
export const DEFAULT_TIERS: TierThresholds = { high: 0.03, medium: 0.015 };
export const MIN_SAMPLES = 6;
/** Used when an event has too little history to learn from. */
const FALLBACK_TIER: Record<string, Tier> = { CPI: "HIGH", "Core CPI": "HIGH", "FOMC Rate Decision": "HIGH", "Nonfarm Payrolls": "HIGH", PCE: "MEDIUM", "Core PCE": "MEDIUM", PPI: "MEDIUM" };

const HOUR = 3_600_000;

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Price at an instant: the open of the hourly candle containing it. */
function priceAt(candles: Candle[], at: number): number | null {
  // candles sorted asc by t
  let lo = 0;
  let hi = candles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= at) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0 || at - candles[best].t >= HOUR) return null;
  return candles[best].o;
}

export function zScore(x: number, xs: number[]): number | null {
  const s = std(xs);
  return s > 0 ? (x - mean(xs)) / s : null;
}

export interface PlaybookOpts {
  windowBeforeH?: number;
  windowAfterH?: number;
  tiers?: TierThresholds;
}

export function buildPlaybook(event: string, history: MacroRelease[], candles: Candle[], opts: PlaybookOpts = {}): Playbook {
  const before = (opts.windowBeforeH ?? 1) * HOUR;
  const after = (opts.windowAfterH ?? 4) * HOUR;
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const meta = eventMeta(event);
  const sorted = [...candles].sort((a, b) => a.t - b.t);

  const surprises = history
    .filter((h) => h.actual != null && h.forecast != null)
    .map((h) => (h.actual as number) - (h.forecast as number));

  const samples: Sample[] = [];
  for (const h of history) {
    const at = releaseTime(h.date, event);
    const p0 = priceAt(sorted, at - before);
    const p1 = priceAt(sorted, at + after);
    if (p0 == null || p1 == null || p0 <= 0) continue;
    const surprise = h.actual != null && h.forecast != null ? h.actual - h.forecast : null;
    const move = p1 / p0 - 1;
    samples.push({
      date: h.date,
      releaseAt: at,
      surprise,
      surpriseZ: surprise == null ? null : zScore(surprise, surprises),
      move,
      absMove: Math.abs(move),
    });
  }

  const abs = samples.map((s) => s.absMove);
  const p90 = quantile(abs, 0.9);
  const lowSample = samples.length < MIN_SAMPLES;
  let tier: Tier = p90 >= tiers.high ? "HIGH" : p90 >= tiers.medium ? "MEDIUM" : "LOW";
  if (lowSample) tier = FALLBACK_TIER[meta.label] ?? "MEDIUM";

  const paired = samples.filter((s) => s.surpriseZ != null);
  let surpriseSensitivity: number | null = null;
  if (paired.length >= 4) {
    const xs = paired.map((s) => Math.abs(s.surpriseZ!));
    const ys = paired.map((s) => s.absMove);
    const mx = mean(xs);
    const my = mean(ys);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    surpriseSensitivity = den > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : null;
  }

  let riskOffHitRate: number | null = null;
  if (meta.riskOffWhen !== "unknown") {
    const sign = meta.riskOffWhen === "higher" ? 1 : -1;
    const riskOff = paired.filter((s) => sign * s.surprise! > 0);
    if (riskOff.length) riskOffHitRate = riskOff.filter((s) => s.move < 0).length / riskOff.length;
  }

  return {
    event,
    label: meta.label,
    n: samples.length,
    medianAbsMove: quantile(abs, 0.5),
    p90AbsMove: p90,
    surpriseSensitivity,
    riskOffHitRate,
    tier,
    lowSample,
    samples,
  };
}

/** Convert SoDEX RPCKline rows ({t,o,c,...} as strings) into Candles. */
export function toCandles(rows: Array<Record<string, unknown>>): Candle[] {
  return rows.map((r) => ({ t: Number(r.t), o: Number(r.o), c: Number(r.c) })).filter((c) => Number.isFinite(c.t) && c.o > 0);
}
