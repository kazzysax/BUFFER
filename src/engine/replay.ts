import type { MacroRelease } from "../sosovalue/client";
import { buildHedgeBracket, buildUnwind } from "../sodex/orders";
import { payloadHash, bodyJson } from "../sodex/payload";
import type { PerpsSymbol } from "../sodex/client";
import { releaseTime } from "./events";
import { buildPlaybook, type Candle, type Playbook } from "./playbook";
import { decideAfterRelease, planHedge, type Guardrails, type HedgePlan, type PostDecision } from "./policy";
import { ReceiptLog } from "./receipts";

const H = 3_600_000;

export interface ReplayPoint {
  t: number;
  price: number;
  unhedged: number;
  hedged: number;
  hedgeOpen: boolean;
}

export interface ReplayResult {
  event: string;
  date: string;
  releaseAt: number;
  playbook: Playbook;
  plan: HedgePlan;
  decision: PostDecision;
  openedAt: number;
  closedAt: number;
  closeReason: "benign_unwind" | "risk_on_unwind" | "max_hold" | "stop_loss" | "take_profit";
  entry: number;
  exit: number;
  qty: number;
  points: ReplayPoint[];
  savedUsd: number; // hedged − unhedged at the end of the window
  worstUnhedgedUsd: number;
  worstHedgedUsd: number;
  receipts: ReceiptLog;
}

// Sample symbol spec used to build real (dry-run) order payloads for receipts.
export const BTC_SYMBOL: PerpsSymbol = { id: 1, name: "BTC-USD", pricePrecision: 1, quantityPrecision: 4, tickSize: "0.1", stepSize: "0.0001" };

function px(candles: Candle[], at: number): number | null {
  const c = candles.find((k) => k.t <= at && at - k.t < H);
  return c ? c.o : null;
}

/**
 * Replays Buffer on one past release, BTC leg only: plan from history *before* that release,
 * open at T−lead, decide on the actual print, close on rule / stop / max hold.
 */
export function replayRelease(args: {
  event: string;
  release: MacroRelease;
  history: MacroRelease[]; // all releases; only those before this one are used to learn
  candles: Candle[];
  btc: number;
  guard: Guardrails;
  accountID?: number;
}): ReplayResult | null {
  const { event, release, guard } = args;
  const releaseAt = releaseTime(release.date, event);
  const prior = args.history.filter((h) => h.date < release.date);
  const candles = [...args.candles].sort((a, b) => a.t - b.t);
  const playbook = buildPlaybook(event, prior, candles.filter((c) => c.t < releaseAt - guard.leadMinutes * 60_000));

  const openAt = Math.floor((releaseAt - guard.leadMinutes * 60_000) / H) * H;
  const entry = px(candles, openAt);
  if (entry == null) return null;
  const plan = planHedge({ event, releaseAt, playbook, holdings: { BTC: args.btc, ETH: 0 }, prices: { BTC: entry, ETH: 0 }, guard });
  const leg = plan.legs.find((l) => l.asset === "BTC");
  const pastSurprises = prior.filter((h) => h.actual != null && h.forecast != null).map((h) => h.actual! - h.forecast!);
  const decision = decideAfterRelease({ event, actual: release.actual, forecast: release.forecast, pastSurprises });

  const log = new ReceiptLog();
  const acct = args.accountID ?? 0;
  log.append("plan", { event, releaseAt, tier: playbook.tier, hedgeRatio: plan.hedgeRatio, reasons: plan.reasons }, openAt - 60_000);

  const qty = leg ? Number(leg.quantity.toFixed(4)) : 0;
  const sl = entry * (1 + (leg?.stopLossPct ?? 0));
  const tp = entry * (1 - (leg?.takeProfitPct ?? 0));
  if (leg && qty > 0) {
    const order = buildHedgeBracket({ accountID: acct, symbol: BTC_SYMBOL, quantity: qty, markPrice: entry, stopLossPct: leg.stopLossPct, takeProfitPct: leg.takeProfitPct });
    log.append("hedge_open", { symbol: "BTC-USD", qty, entry: +entry.toFixed(1), stopLoss: +sl.toFixed(1), takeProfit: +tp.toFixed(1), payloadHash: payloadHash(order), body: bodyJson(order), mode: "dry_run" }, openAt);
  }

  // decision time: first full hour after release
  const decideAt = Math.ceil((releaseAt + 5 * 60_000) / H) * H;
  const plannedClose = decision.action === "UNWIND_NOW" ? decideAt : plan.closeBy;
  let closedAt = plannedClose;
  let closeReason: ReplayResult["closeReason"] =
    decision.action === "UNWIND_NOW" ? ((decision.surpriseZ ?? 0) !== 0 && Math.abs(decision.surpriseZ ?? 0) >= 0.5 ? "risk_on_unwind" : "benign_unwind") : "max_hold";

  const from = openAt - 3 * H;
  const to = Math.max(plan.closeBy, decideAt) + 2 * H;
  const points: ReplayPoint[] = [];
  let open = false;
  let exit = entry;
  let closed = !(leg && qty > 0);
  for (const c of candles) {
    if (c.t < from || c.t > to) continue;
    const price = c.o;
    if (!closed && c.t >= openAt) open = true;
    if (open && !closed) {
      // stops checked on the hour (conservative: open price of each hourly candle)
      if (c.t > openAt && price >= sl) {
        closedAt = c.t;
        closeReason = "stop_loss";
      } else if (c.t > openAt && price <= tp) {
        closedAt = c.t;
        closeReason = "take_profit";
      }
      if (c.t >= closedAt) {
        exit = price;
        closed = true;
        open = false;
      }
    }
    const shortPnl = qty * (entry - (closed && c.t >= closedAt ? exit : price));
    const active = c.t >= openAt && (open || (closed && c.t >= closedAt && qty > 0));
    points.push({ t: c.t, price, unhedged: args.btc * price, hedged: args.btc * price + (active ? shortPnl : 0), hedgeOpen: open });
  }
  if (!points.length) return null;

  log.append("release", { actual: release.actual, forecast: release.forecast, surpriseZ: decision.surpriseZ, action: decision.action, reason: decision.reason }, decideAt);
  if (qty > 0) {
    const un = buildUnwind(acct, BTC_SYMBOL, qty);
    log.append("hedge_close", { reason: closeReason, exit: +exit.toFixed(1), pnlUsd: +(qty * (entry - exit)).toFixed(2), payloadHash: payloadHash(un), mode: "dry_run" }, closedAt);
  }

  const start = points[0];
  const end = points.at(-1)!;
  return {
    event,
    date: release.date,
    releaseAt,
    playbook,
    plan,
    decision,
    openedAt: openAt,
    closedAt,
    closeReason,
    entry,
    exit,
    qty,
    points,
    savedUsd: end.hedged - end.unhedged,
    worstUnhedgedUsd: Math.min(...points.map((p) => p.unhedged)) - start.unhedged,
    worstHedgedUsd: Math.min(...points.map((p) => p.hedged)) - start.hedged,
    receipts: log,
  };
}
