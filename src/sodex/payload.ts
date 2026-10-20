import { keccak256, toHex, type Hex } from "viem";
import type {
  Action,
  CancelItem,
  CancelOrderParams,
  NewOrderParams,
  PerpsOrderItem,
  ScheduleCancelParams,
  UpdateLeverageParams,
} from "./types";

// The server re-marshals the body with Go's json.Marshal, so keys must appear in
// Go struct field order and `omitempty` fields must be dropped when unset.
// Each canonicalizer rebuilds the object in that order regardless of input order.

function put<T extends object>(o: T, k: string, v: unknown, omitEmpty = false) {
  if (omitEmpty && (v === undefined || v === null)) return;
  (o as Record<string, unknown>)[k] = v;
}

function assertDec(name: string, v: unknown) {
  if (v === undefined) return;
  if (typeof v !== "string" || !/^-?\d+(\.\d+)?$/.test(v)) {
    throw new Error(`${name} must be a decimal string, got ${JSON.stringify(v)}`);
  }
}

export function canonOrder(o: PerpsOrderItem): PerpsOrderItem {
  for (const k of ["price", "quantity", "funds", "stopPrice"] as const) assertDec(k, o[k]);
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(o.clOrdID)) throw new Error(`bad clOrdID ${o.clOrdID}`);
  const out = {} as PerpsOrderItem;
  put(out, "clOrdID", o.clOrdID);
  put(out, "modifier", o.modifier);
  put(out, "side", o.side);
  put(out, "type", o.type);
  put(out, "timeInForce", o.timeInForce);
  put(out, "price", o.price, true);
  put(out, "quantity", o.quantity, true);
  put(out, "funds", o.funds, true);
  put(out, "stopPrice", o.stopPrice, true);
  put(out, "stopType", o.stopType, true);
  put(out, "triggerType", o.triggerType, true);
  put(out, "reduceOnly", o.reduceOnly);
  put(out, "positionSide", o.positionSide);
  return out;
}

function canonNewOrder(p: NewOrderParams): NewOrderParams {
  if (!p.orders.length || p.orders.length > 100) throw new Error("orders must have 1..100 items");
  return { accountID: p.accountID, symbolID: p.symbolID, orders: p.orders.map(canonOrder) };
}

function canonCancelItem(c: CancelItem): CancelItem {
  if ((c.orderID === undefined) === (c.clOrdID === undefined)) {
    throw new Error("cancel item needs exactly one of orderID / clOrdID");
  }
  const out = {} as CancelItem;
  put(out, "symbolID", c.symbolID);
  put(out, "orderID", c.orderID, true);
  put(out, "clOrdID", c.clOrdID, true);
  return out;
}

function canonCancel(p: CancelOrderParams): CancelOrderParams {
  return { accountID: p.accountID, cancels: p.cancels.map(canonCancelItem) };
}

function canonScheduleCancel(p: ScheduleCancelParams): ScheduleCancelParams {
  const out = { accountID: p.accountID } as ScheduleCancelParams;
  put(out, "scheduledTimestamp", p.scheduledTimestamp, true);
  return out;
}

function canonLeverage(p: UpdateLeverageParams): UpdateLeverageParams {
  return { accountID: p.accountID, symbolID: p.symbolID, leverage: p.leverage, marginMode: p.marginMode };
}

export function canonical(a: Action): Action {
  switch (a.type) {
    case "newOrder":
      return { type: a.type, params: canonNewOrder(a.params) };
    case "cancelOrder":
      return { type: a.type, params: canonCancel(a.params) };
    case "scheduleCancel":
      return { type: a.type, params: canonScheduleCancel(a.params) };
    case "updateLeverage":
      return { type: a.type, params: canonLeverage(a.params) };
  }
}

/** Compact JSON of {type, params}; this exact string is what gets hashed. */
export function signingJson(a: Action): string {
  const c = canonical(a);
  return JSON.stringify({ type: c.type, params: c.params });
}

/** HTTP body = params only, same order and types as the signing payload. */
export function bodyJson(a: Action): string {
  return JSON.stringify(canonical(a).params);
}

export function payloadHash(a: Action): Hex {
  return keccak256(toHex(signingJson(a)));
}
