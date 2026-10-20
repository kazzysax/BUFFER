// Enum values mirror sodex-go-sdk-public/common/enums (iota order).
export const Side = { BUY: 1, SELL: 2 } as const;
export const OrderType = { LIMIT: 1, MARKET: 2 } as const;
export const TimeInForce = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;
export const Modifier = { NORMAL: 1, STOP: 2, BRACKET: 3, ATTACHED_STOP: 4 } as const;
export const PositionSide = { BOTH: 1, LONG: 2, SHORT: 3 } as const;
export const StopType = { STOP_LOSS: 1, TAKE_PROFIT: 2 } as const;
export const TriggerType = { LAST_PRICE: 1, MARK_PRICE: 2, INDEX_PRICE: 3 } as const;
export const MarginMode = { ISOLATED: 1, CROSS: 2 } as const;

export type Network = "testnet" | "mainnet";

export const CHAIN_ID: Record<Network, number> = { testnet: 138565, mainnet: 286623 };
export const PERPS_BASE: Record<Network, string> = {
  testnet: "https://testnet-gw.sodex.dev/api/v1/perps",
  mainnet: "https://mainnet-gw.sodex.dev/api/v1/perps",
};

/** Decimal values are passed as strings, exactly as they must appear on the wire. */
export type Dec = string;

export interface PerpsOrderItem {
  clOrdID: string;
  modifier: number;
  side: number;
  type: number;
  timeInForce: number;
  price?: Dec;
  quantity?: Dec;
  funds?: Dec;
  stopPrice?: Dec;
  stopType?: number;
  triggerType?: number;
  reduceOnly: boolean;
  positionSide: number;
}

export interface NewOrderParams {
  accountID: number;
  symbolID: number;
  orders: PerpsOrderItem[];
}

export interface CancelItem {
  symbolID: number;
  orderID?: number;
  clOrdID?: string;
}

export interface CancelOrderParams {
  accountID: number;
  cancels: CancelItem[];
}

export interface ScheduleCancelParams {
  accountID: number;
  scheduledTimestamp?: number;
}

export interface UpdateLeverageParams {
  accountID: number;
  symbolID: number;
  leverage: number;
  marginMode: number;
}

export type Action =
  | { type: "newOrder"; params: NewOrderParams }
  | { type: "cancelOrder"; params: CancelOrderParams }
  | { type: "scheduleCancel"; params: ScheduleCancelParams }
  | { type: "updateLeverage"; params: UpdateLeverageParams };
