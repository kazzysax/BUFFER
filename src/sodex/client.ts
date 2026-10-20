import type { Hex } from "viem";
import { bodyJson } from "./payload";
import { signAction, type VMode } from "./signer";
import { PERPS_BASE, type Action, type Network } from "./types";

export interface SodexEnvelope<T> {
  code: number;
  timestamp?: number;
  error?: string;
  data: T;
}

export class SodexError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg);
  }
}

export interface PerpsSymbol {
  id: number;
  name: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
  minQuantity?: string;
  minNotional?: string;
  maxLeverage?: number;
  [k: string]: unknown;
}

export interface OrderResult {
  code: number;
  clOrdID: string;
  orderID?: number;
  error?: string;
}

export class SodexPerps {
  readonly base: string;
  constructor(
    readonly network: Network,
    private signing?: { privateKey: Hex; apiKeyName?: string; vMode?: VMode },
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = PERPS_BASE[network];
  }

  private async req<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let json: SodexEnvelope<T>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new SodexError(res.status, text, `SoDEX ${method} ${path} → ${res.status} non-JSON`);
    }
    if (!res.ok || json.code !== 0) {
      throw new SodexError(res.status, json, `SoDEX ${method} ${path} → ${res.status} code=${json.code} ${json.error ?? ""}`.trim());
    }
    return json.data;
  }

  // ---- public reads
  symbols(symbol?: string) {
    return this.req<PerpsSymbol[]>("GET", `/markets/symbols${symbol ? `?symbol=${symbol}` : ""}`);
  }
  markPrices(symbol?: string) {
    return this.req<Array<Record<string, unknown>>>("GET", `/markets/mark-prices${symbol ? `?symbol=${symbol}` : ""}`);
  }
  klines(symbol: string, interval: string, q: { startTime?: number; endTime?: number; limit?: number } = {}) {
    const p = new URLSearchParams({ interval });
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
    return this.req<Array<Record<string, unknown>>>("GET", `/markets/${symbol}/klines?${p}`);
  }

  // ---- account reads
  state(addr: string, accountID?: number) {
    return this.req<Record<string, unknown>>("GET", `/accounts/${addr}/state${accountID ? `?accountID=${accountID}` : ""}`);
  }
  positions(addr: string, accountID?: number) {
    return this.req<unknown>("GET", `/accounts/${addr}/positions${accountID ? `?accountID=${accountID}` : ""}`);
  }
  balances(addr: string, accountID?: number) {
    return this.req<unknown>("GET", `/accounts/${addr}/balances${accountID ? `?accountID=${accountID}` : ""}`);
  }

  // ---- signed writes
  private static PATH: Record<Action["type"], [string, string]> = {
    newOrder: ["POST", "/trade/orders"],
    cancelOrder: ["DELETE", "/trade/orders"],
    scheduleCancel: ["POST", "/trade/orders/schedule-cancel"],
    updateLeverage: ["POST", "/trade/leverage"],
  };

  /** Builds the exact signed request without sending it (dry-run / receipts). */
  async prepare(action: Action) {
    if (!this.signing) throw new Error("SodexPerps: no signing key configured");
    const [method, path] = SodexPerps.PATH[action.type];
    const signed = await signAction({ action, network: this.network, ...this.signing });
    return {
      method,
      url: this.base + path,
      path,
      headers: { "Content-Type": "application/json", ...signed.headers } as Record<string, string>,
      body: bodyJson(action),
      payloadHash: signed.payloadHash,
      signer: signed.signer,
    };
  }

  async send<T = unknown>(action: Action): Promise<T> {
    const p = await this.prepare(action);
    return this.req<T>(p.method, p.path, { headers: p.headers, body: p.body });
  }
}
