import type { PerpsSymbol } from "./client";
import { Modifier, OrderType, PositionSide, Side, StopType, TimeInForce, TriggerType, type Action, type PerpsOrderItem } from "./types";

// ---- decimal helpers (string math via scaled BigInt; no float drift on the wire)

function decimalsOf(step: string) {
  const i = step.indexOf(".");
  return i < 0 ? 0 : step.length - i - 1;
}
function toUnits(v: string, d: number) {
  const [w, f = ""] = v.split(".");
  return BigInt(w + (f + "0".repeat(d)).slice(0, d));
}
function fromUnits(u: bigint, d: number) {
  const neg = u < 0n;
  const s = (neg ? -u : u).toString().padStart(d + 1, "0");
  const out = d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
  return (neg ? "-" : "") + out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Round `value` down (or up) to a multiple of `step`, returned as a decimal string. */
export function roundToStep(value: number, step: string, mode: "down" | "up" | "nearest" = "down"): string {
  const d = Math.max(decimalsOf(step), 0);
  const stepU = toUnits(step, d);
  if (!(value >= 0)) throw new Error(`roundToStep expects a non-negative number, got ${value}`);
  const vU = toUnits(value.toFixed(d + 4), d + 4);
  const scale = 10n ** 4n;
  const stepU4 = stepU * scale;
  let q = vU / stepU4;
  const r = vU % stepU4;
  if (mode === "up" && r > 0n) q += 1n;
  if (mode === "nearest" && r * 2n >= stepU4) q += 1n;
  return fromUnits(q * stepU, d);
}

let seq = 0;
export function clOrdID(tag: string) {
  seq = (seq + 1) % 1000;
  return `${tag}-${Date.now().toString(36)}-${seq}`.slice(0, 36);
}

export interface HedgeOrderInput {
  accountID: number;
  symbol: PerpsSymbol;
  quantity: number; // base units to short
  markPrice: number;
  stopLossPct: number; // e.g. 0.03 → SL 3% above entry
  takeProfitPct: number; // e.g. 0.03 → TP 3% below entry
}

/**
 * Bracket: market short (IOC) + attached reduce-only SL above and TP below, triggered on mark price.
 * Rules (perps API): batch length 2–3, [0].modifier=BRACKET reduceOnly=false, rest ATTACHED_STOP reduceOnly=true.
 */
export function buildHedgeBracket(i: HedgeOrderInput): Action {
  const qty = roundToStep(i.quantity, i.symbol.stepSize, "down");
  if (Number(qty) <= 0) throw new Error(`hedge quantity rounds to 0 at step ${i.symbol.stepSize}`);
  const sl = roundToStep(i.markPrice * (1 + i.stopLossPct), i.symbol.tickSize, "up");
  const tp = roundToStep(i.markPrice * (1 - i.takeProfitPct), i.symbol.tickSize, "down");
  const entry: PerpsOrderItem = {
    clOrdID: clOrdID("bf-hedge"),
    modifier: Modifier.BRACKET,
    side: Side.SELL,
    type: OrderType.MARKET,
    timeInForce: TimeInForce.IOC,
    quantity: qty,
    reduceOnly: false,
    positionSide: PositionSide.BOTH,
  };
  const stop = (stopType: number, stopPrice: string, tag: string): PerpsOrderItem => ({
    clOrdID: clOrdID(tag),
    modifier: Modifier.ATTACHED_STOP,
    side: Side.BUY,
    type: OrderType.MARKET,
    timeInForce: TimeInForce.IOC,
    quantity: qty,
    stopPrice,
    stopType,
    triggerType: TriggerType.MARK_PRICE,
    reduceOnly: true,
    positionSide: PositionSide.BOTH,
  });
  return {
    type: "newOrder",
    params: {
      accountID: i.accountID,
      symbolID: i.symbol.id,
      orders: [entry, stop(StopType.STOP_LOSS, sl, "bf-sl"), stop(StopType.TAKE_PROFIT, tp, "bf-tp")],
    },
  };
}

/** Reduce-only market buy to close (part of) a short hedge. */
export function buildUnwind(accountID: number, symbol: PerpsSymbol, quantity: number): Action {
  return {
    type: "newOrder",
    params: {
      accountID,
      symbolID: symbol.id,
      orders: [
        {
          clOrdID: clOrdID("bf-unwind"),
          modifier: Modifier.NORMAL,
          side: Side.BUY,
          type: OrderType.MARKET,
          timeInForce: TimeInForce.IOC,
          quantity: roundToStep(quantity, symbol.stepSize, "up"),
          reduceOnly: true,
          positionSide: PositionSide.BOTH,
        },
      ],
    },
  };
}

export function buildDeadMan(accountID: number, atMs: number): Action {
  return { type: "scheduleCancel", params: { accountID, scheduledTimestamp: atMs } };
}
