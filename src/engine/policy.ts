import { eventMeta } from "./events";
import { zScore, type Playbook, type Tier } from "./playbook";

export interface Holdings {
  BTC: number;
  ETH: number;
}

export interface Guardrails {
  maxHedgeRatio: number; // 0..1 of holdings value
  maxNotionalUsd: number; // per asset per event
  maxLeverage: number;
  leadMinutes: number; // open hedge this long before release
  maxHoldHours: number; // hard unwind + dead-man time after release
  aggressiveness: number; // 0..1.5 multiplier on tier base ratio
  dryRun: boolean;
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  maxHedgeRatio: 0.5,
  maxNotionalUsd: 5_000,
  maxLeverage: 2,
  leadMinutes: 60,
  maxHoldHours: 6,
  aggressiveness: 1,
  dryRun: true,
};

const BASE_RATIO: Record<Tier, number> = { HIGH: 0.5, MEDIUM: 0.25, LOW: 0 };

export interface HedgeLeg {
  asset: keyof Holdings;
  symbol: string;
  quantity: number;
  notionalUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export interface HedgePlan {
  event: string;
  label: string;
  releaseAt: number;
  openAt: number;
  closeBy: number;
  tier: Tier;
  hedgeRatio: number;
  legs: HedgeLeg[];
  reasons: string[];
  skip: boolean;
}

const SYMBOL: Record<keyof Holdings, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };

export function planHedge(args: {
  event: string;
  releaseAt: number;
  playbook: Playbook;
  holdings: Holdings;
  prices: Record<keyof Holdings, number>;
  guard: Guardrails;
  /** From the news analyst; already clamped there. Applied before guardrail caps, so it can never exceed them. */
  agent?: { sizeMultiplier: number; note: string };
}): HedgePlan {
  const { playbook: pb, guard } = args;
  const reasons: string[] = [];
  const mult = args.agent?.sizeMultiplier ?? 1;
  const raw = BASE_RATIO[pb.tier] * guard.aggressiveness * mult;
  const hedgeRatio = Math.min(raw, guard.maxHedgeRatio);
  reasons.push(
    pb.n > 0
      ? `${pb.label} has moved bitcoin ${(pb.medianAbsMove * 100).toFixed(1)}% on a typical release and ${(pb.p90AbsMove * 100).toFixed(1)}% on a bad one, across the last ${pb.n}${pb.lowSample ? ", too few to be sure, so Buffer uses its default rating" : ""}.`
      : `No price history for ${pb.label} yet, so Buffer uses its default rating.`,
  );
  if (args.agent && mult !== 1 && pb.tier !== "LOW") {
    reasons.push(`The agent sized it ×${mult.toFixed(2)}: ${args.agent.note.trim().replace(/([^.!?])$/, "$1.")}`);
  }
  if (raw > guard.maxHedgeRatio) reasons.push(`Capped at ${Math.round(guard.maxHedgeRatio * 100)}% of holdings by your limit.`);

  // Stops sized from history: hedge stops out if price rips by more than a typical tail move.
  const band = Math.min(Math.max(pb.p90AbsMove, 0.01), 0.08);
  const legs: HedgeLeg[] = [];
  for (const asset of ["BTC", "ETH"] as const) {
    const amt = args.holdings[asset];
    const px = args.prices[asset];
    if (!(amt > 0) || !(px > 0) || hedgeRatio <= 0) continue;
    let notional = amt * px * hedgeRatio;
    if (notional > guard.maxNotionalUsd) {
      reasons.push(`${asset} hedge capped at $${guard.maxNotionalUsd.toLocaleString("en-US")} by your limit.`);
      notional = guard.maxNotionalUsd;
    }
    legs.push({ asset, symbol: SYMBOL[asset], quantity: notional / px, notionalUsd: notional, stopLossPct: band, takeProfitPct: band });
  }

  const skip = legs.length === 0;
  if (pb.tier === "LOW") reasons.push("That is small enough to ride out, so no hedge.");
  return {
    event: args.event,
    label: pb.label,
    releaseAt: args.releaseAt,
    openAt: args.releaseAt - guard.leadMinutes * 60_000,
    closeBy: args.releaseAt + guard.maxHoldHours * 3_600_000,
    tier: pb.tier,
    hedgeRatio,
    legs,
    reasons,
    skip,
  };
}

export type PostAction = "UNWIND_NOW" | "HOLD_TIGHTEN" | "WAIT";

export interface PostDecision {
  action: PostAction;
  surprise: number | null;
  surpriseZ: number | null;
  reason: string;
}

/**
 * After the release: benign (|z| < 0.5) or risk-on surprise → unwind;
 * risk-off surprise → keep the hedge, move SL to break-even, unwind by closeBy.
 */
export function decideAfterRelease(args: {
  event: string;
  actual: number | null;
  forecast: number | null;
  pastSurprises: number[];
  benignZ?: number;
}): PostDecision {
  const benign = args.benignZ ?? 0.5;
  if (args.actual == null || args.forecast == null) {
    return { action: "WAIT", surprise: null, surpriseZ: null, reason: "Waiting for the number to be published." };
  }
  const surprise = args.actual - args.forecast;
  const z = zScore(surprise, args.pastSurprises);
  const meta = eventMeta(args.event);
  const zTxt = z == null ? "n/a" : Math.abs(z).toFixed(2); // direction is in the words; σ shows size
  if (z != null && Math.abs(z) < benign) {
    return { action: "UNWIND_NOW", surprise, surpriseZ: z, reason: `Came in close to forecast (${zTxt}σ), so the hedge comes off.` };
  }
  if (meta.riskOffWhen === "unknown") {
    return { action: "HOLD_TIGHTEN", surprise, surpriseZ: z, reason: `A ${zTxt}σ surprise with no clear direction, so the hedge stays on with its stop moved to break-even.` };
  }
  const riskOff = (meta.riskOffWhen === "higher" ? 1 : -1) * surprise > 0;
  return riskOff
    ? { action: "HOLD_TIGHTEN", surprise, surpriseZ: z, reason: `Worse than forecast for crypto (${zTxt}σ), so the hedge stays on with its stop moved to break-even.` }
    : { action: "UNWIND_NOW", surprise, surpriseZ: z, reason: `Better than forecast for crypto (${zTxt}σ), so the hedge comes off.` };
}
