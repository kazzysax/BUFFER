import type { MacroRelease } from "../sosovalue/client";
import type { PerpsSymbol } from "../sodex/client";
import { buildHedgeBracket, buildUnwind, clOrdID, roundToStep } from "../sodex/orders";
import { payloadHash } from "../sodex/payload";
import { MarginMode, Modifier, OrderType, PositionSide, Side, StopType, TimeInForce, TriggerType, type Action } from "../sodex/types";
import type { TimelineItem } from "./pipeline";
import { decideAfterRelease, type Guardrails, type PostDecision } from "./policy";

/**
 * The executor: a small state machine per planned hedge, advanced on every tick (cron, or "Run now").
 *
 * Each hedge carries its own stop-loss and take-profit on SoDEX, so it stays protected even if
 * Buffer is offline.
 *
 *   (none) ──openAt──▶ open ──release+5m, actual in──▶ closed            (in line / good news)
 *                        │                         └──▶ holding ──closeBy──▶ closed   (bad news)
 *                        └──────────────── closeBy / kill switch ──────────▶ closed
 *
 * Practice mode runs the exact same path, signs nothing it can't, and sends nothing.
 */

export type HedgeStatus = "open" | "holding" | "closed" | "skipped" | "failed";
export type CloseReason = "in_line" | "good_news" | "max_hold" | "kill_switch" | "stop_or_target";

export interface LegState {
  asset: "BTC" | "ETH";
  symbol: string;
  qty: number;
  entry: number;
  stopLossPct: number;
  takeProfitPct: number;
  orderIDs: number[];
  clOrdIDs: string[];
  exit?: number;
  pnlUsd?: number;
  error?: string;
}

export interface HedgeState {
  id: string;
  event: string;
  label: string;
  date: string;
  releaseAt: number;
  openAt: number;
  closeBy: number;
  mode: "practice" | "live";
  status: HedgeStatus;
  legs: LegState[];
  decision?: Pick<PostDecision, "action" | "reason" | "surpriseZ">;
  closeReason?: CloseReason;
  note?: string;
  openedAt?: number;
  closedAt?: number;
  updatedAt: number;
}

export interface Trader {
  symbol(name: string): Promise<PerpsSymbol>;
  send(action: Action): Promise<unknown>;
}

export interface ExecIO {
  now: number;
  items: TimelineItem[];
  guard: Guardrails;
  live: boolean;
  trusted: boolean; // holdings confirmed / synced recently
  accountID: number; // 0 in practice mode
  marks(): Promise<Record<string, number>>; // "BTC-USD" → mark price
  release(event: string, date: string): Promise<MacroRelease | null>;
  pastSurprises(event: string, beforeDate: string): Promise<number[]>;
  trader?: Trader; // required when live
  receipt(kind: string, data: Record<string, unknown>, at?: number): Promise<void>;
}

const PRACTICE_SYMBOL: Record<string, PerpsSymbol> = {
  "BTC-USD": { id: 1, name: "BTC-USD", pricePrecision: 1, quantityPrecision: 4, tickSize: "0.1", stepSize: "0.0001" },
  "ETH-USD": { id: 2, name: "ETH-USD", pricePrecision: 2, quantityPrecision: 3, tickSize: "0.01", stepSize: "0.001" },
};

const DECIDE_AFTER_MS = 5 * 60_000;

function orderIDsFrom(res: unknown): { ids: number[]; errors: string[] } {
  const arr = Array.isArray(res) ? res : [];
  const ids: number[] = [];
  const errors: string[] = [];
  for (const r of arr as Array<{ code?: number; orderID?: number; error?: string }>) {
    if (r.code === 0 && r.orderID != null) ids.push(r.orderID);
    else if (r.error) errors.push(r.error);
  }
  return { ids, errors };
}

async function symbolFor(io: ExecIO, name: string) {
  return io.live && io.trader ? io.trader.symbol(name) : PRACTICE_SYMBOL[name];
}

async function openHedge(item: TimelineItem, io: ExecIO): Promise<HedgeState> {
  const base: HedgeState = {
    id: item.id,
    event: item.event,
    label: item.meta.label,
    date: item.date,
    releaseAt: item.releaseAt,
    openAt: item.plan.openAt,
    closeBy: item.plan.closeBy,
    mode: io.live ? "live" : "practice",
    status: "open",
    legs: [],
    openedAt: io.now,
    updatedAt: io.now,
  };
  if (io.live && !io.trusted) {
    await io.receipt("hedge_skipped", { event: item.event, reason: "holdings_unconfirmed" });
    return { ...base, status: "skipped", note: "Holdings weren't confirmed in the last 7 days, so no live hedge was opened." };
  }
  if (io.live && !io.trader) return { ...base, status: "failed", note: "Live mode is on but SoDEX isn't connected." };

  const marks = await io.marks();
  for (const leg of item.plan.legs) {
    const mark = marks[leg.symbol];
    const ls: LegState = { asset: leg.asset, symbol: leg.symbol, qty: 0, entry: mark, stopLossPct: leg.stopLossPct, takeProfitPct: leg.takeProfitPct, orderIDs: [], clOrdIDs: [] };
    if (!(mark > 0)) {
      ls.error = `No price for ${leg.symbol}.`;
      base.legs.push(ls);
      continue;
    }
    try {
      const sym = await symbolFor(io, leg.symbol);
      // Re-size at the live price, capped so it never exceeds the planned notional.
      const qty = Number(roundToStep(Math.min(leg.quantity, leg.notionalUsd / mark), sym.stepSize, "down"));
      if (!(qty > 0)) throw new Error(`Hedge rounds to zero at step ${sym.stepSize}.`);
      ls.qty = qty;
      const order = buildHedgeBracket({ accountID: io.accountID, symbol: sym, quantity: qty, markPrice: mark, stopLossPct: leg.stopLossPct, takeProfitPct: leg.takeProfitPct });
      if (order.type === "newOrder") ls.clOrdIDs = order.params.orders.map((o) => o.clOrdID);
      if (io.live && io.trader) {
        await io.trader.send({ type: "updateLeverage", params: { accountID: io.accountID, symbolID: sym.id, leverage: io.guard.maxLeverage, marginMode: MarginMode.ISOLATED } }).catch(() => undefined);
        const res = orderIDsFrom(await io.trader.send(order));
        ls.orderIDs = res.ids;
        if (!res.ids.length) throw new Error(res.errors.join("; ") || "SoDEX accepted no orders.");
      }
      await io.receipt("hedge_open", { event: item.event, symbol: leg.symbol, qty, entry: +mark.toFixed(2), stopLossPct: leg.stopLossPct, takeProfitPct: leg.takeProfitPct, mode: base.mode, orderIDs: ls.orderIDs, payloadHash: payloadHash(order) });
    } catch (e) {
      ls.error = (e as Error).message;
      await io.receipt("hedge_open_failed", { event: item.event, symbol: leg.symbol, error: ls.error });
    }
    base.legs.push(ls);
  }

  const opened = base.legs.filter((l) => !l.error && l.qty > 0);
  if (!opened.length) return { ...base, status: "failed", note: base.legs.map((l) => l.error).filter(Boolean).join(" ") || "No hedge legs to open." };

  // No account-wide schedule-cancel here on purpose: it would also cancel the stop and target,
  // leaving a naked short if Buffer went offline. The attached stop/target live on SoDEX instead.
  return base;
}

async function closeHedge(h: HedgeState, reason: CloseReason, io: ExecIO): Promise<HedgeState> {
  const marks = await io.marks();
  const legs: LegState[] = [];
  for (const l of h.legs) {
    if (l.error || !(l.qty > 0)) {
      legs.push(l);
      continue;
    }
    const exit = marks[l.symbol] ?? l.entry;
    const next = { ...l, exit, pnlUsd: +(l.qty * (l.entry - exit)).toFixed(2) };
    let unwindHash: string | undefined;
    try {
      const sym = await symbolFor(io, l.symbol);
      const unwind = buildUnwind(io.accountID, sym, l.qty);
      unwindHash = payloadHash(unwind);
      if (h.mode === "live" && io.trader) {
        // pull the resting stop / target first, then flatten with a reduce-only buy
        await io.trader
          .send({ type: "cancelOrder", params: { accountID: io.accountID, cancels: l.clOrdIDs.slice(1).map((c) => ({ symbolID: sym.id, clOrdID: c })) } })
          .catch(() => undefined);
        const res = orderIDsFrom(await io.trader.send(unwind));
        if (!res.ids.length && res.errors.length) next.error = `Unwind: ${res.errors.join("; ")} (the stop or target may already have closed it).`;
      }
    } catch (e) {
      next.error = `Unwind: ${(e as Error).message}`;
    }
    await io.receipt("hedge_close", { event: h.event, symbol: l.symbol, reason, exit: +exit.toFixed(2), pnlUsd: next.pnlUsd, mode: h.mode, payloadHash: unwindHash });
    legs.push(next);
  }
  return { ...h, legs, status: "closed", closeReason: reason, closedAt: io.now, updatedAt: io.now };
}

async function holdWithBreakEven(h: HedgeState, d: PostDecision, io: ExecIO): Promise<HedgeState> {
  const legs = [...h.legs];
  if (h.mode === "live" && io.trader) {
    for (const l of legs) {
      if (l.error || !(l.qty > 0)) continue;
      try {
        const sym = await symbolFor(io, l.symbol);
        const id = clOrdID("bf-be");
        await io.trader.send({
          type: "newOrder",
          params: {
            accountID: io.accountID,
            symbolID: sym.id,
            orders: [
              {
                clOrdID: id,
                modifier: Modifier.STOP,
                side: Side.BUY,
                type: OrderType.MARKET,
                timeInForce: TimeInForce.IOC,
                quantity: roundToStep(l.qty, sym.stepSize, "up"),
                stopPrice: roundToStep(l.entry, sym.tickSize, "up"),
                stopType: StopType.STOP_LOSS,
                triggerType: TriggerType.MARK_PRICE,
                reduceOnly: true,
                positionSide: PositionSide.BOTH,
              },
            ],
          },
        });
        l.clOrdIDs = [...l.clOrdIDs, id];
      } catch (e) {
        l.error = `Break-even stop: ${(e as Error).message}`;
      }
    }
  }
  await io.receipt("release", { event: h.event, action: d.action, surpriseZ: d.surpriseZ, reason: d.reason });
  return { ...h, legs, status: "holding", decision: { action: d.action, reason: d.reason, surpriseZ: d.surpriseZ }, updatedAt: io.now };
}

/** Advance every hedge one step. Returns the new state map; only changed entries differ. */
export async function tick(states: Record<string, HedgeState>, io: ExecIO): Promise<Record<string, HedgeState>> {
  const out = { ...states };

  // 1. open new hedges whose window has started
  for (const item of io.items) {
    if (item.plan.skip || out[item.id]) continue;
    if (io.now >= item.plan.openAt && io.now < item.releaseAt) out[item.id] = await openHedge(item, io);
  }

  // 2. advance live ones
  for (const h of Object.values(out)) {
    if (h.status !== "open" && h.status !== "holding") continue;
    if (io.now >= h.closeBy) {
      out[h.id] = await closeHedge(h, "max_hold", io);
      continue;
    }
    if (h.status === "open" && io.now >= h.releaseAt + DECIDE_AFTER_MS) {
      const rel = await io.release(h.event, h.date);
      if (!rel || rel.actual == null) continue; // number not out yet; stay hedged
      const d = decideAfterRelease({ event: h.event, actual: rel.actual, forecast: rel.forecast, pastSurprises: await io.pastSurprises(h.event, h.date) });
      if (d.action === "UNWIND_NOW") {
        await io.receipt("release", { event: h.event, action: d.action, surpriseZ: d.surpriseZ, reason: d.reason });
        const closed = await closeHedge(h, Math.abs(d.surpriseZ ?? 0) < 0.5 ? "in_line" : "good_news", io);
        out[h.id] = { ...closed, decision: { action: d.action, reason: d.reason, surpriseZ: d.surpriseZ } };
      } else if (d.action === "HOLD_TIGHTEN") {
        out[h.id] = await holdWithBreakEven(h, d, io);
      }
    }
  }
  return out;
}

/** Kill switch: close everything now, reduce-only. */
export async function killAll(states: Record<string, HedgeState>, io: ExecIO): Promise<Record<string, HedgeState>> {
  const out = { ...states };
  for (const h of Object.values(out)) if (h.status === "open" || h.status === "holding") out[h.id] = await closeHedge(h, "kill_switch", io);
  await io.receipt("kill_switch", { closed: Object.values(out).filter((h) => h.closeReason === "kill_switch" && h.closedAt === io.now).length });
  return out;
}
