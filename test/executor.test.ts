import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, toHex, encodeAbiParameters, concatHex, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { killAll, tick, type ExecIO, type HedgeState } from "../src/engine/executor";
import type { TimelineItem } from "../src/engine/pipeline";
import { DEFAULT_GUARDRAILS, planHedge } from "../src/engine/policy";
import { eventMeta } from "../src/engine/events";
import { addApiKeyBody, addApiKeyTypedData, universalWireSig } from "../src/sodex/apikey";
import { clampSettings, effectiveHoldings, holdingsTrusted, DEFAULT_SETTINGS } from "../src/account/settings";
import type { Action } from "../src/sodex/types";

const H = 3_600_000;
const RELEASE = Date.UTC(2026, 10, 12, 13, 30);

function item(): TimelineItem {
  const pb = { event: "CPI", label: "CPI", n: 12, medianAbsMove: 0.02, p90AbsMove: 0.04, surpriseSensitivity: null, riskOffHitRate: 0.8, tier: "HIGH" as const, lowSample: false, samples: [] };
  const plan = planHedge({ event: "CPI", releaseAt: RELEASE, playbook: pb, holdings: { BTC: 0.2, ETH: 0 }, prices: { BTC: 60_000, ETH: 2_500 }, guard: DEFAULT_GUARDRAILS });
  return { id: "2026-11-12-cpi", event: "CPI", date: "2026-11-12", meta: eventMeta("CPI"), releaseAt: RELEASE, playbook: pb, plan, explanation: { text: "", source: "fallback" } };
}

function io(over: Partial<ExecIO> & { actual?: number | null; price?: number } = {}) {
  const receipts: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const sent: Action[] = [];
  const base: ExecIO = {
    now: RELEASE - 30 * 60_000,
    items: [item()],
    guard: DEFAULT_GUARDRAILS,
    live: false,
    trusted: true,
    accountID: 0,
    marks: async () => ({ "BTC-USD": over.price ?? 60_000, "ETH-USD": 2_500 }),
    release: async () => ({ date: "2026-11-12", forecast: 3.0, actual: over.actual === undefined ? 3.0 : over.actual, previous: 3.0 }),
    pastSurprises: async () => [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1, 0.25, -0.15, 0.05],
    receipt: async (kind, data) => {
      receipts.push({ kind, data });
    },
  };
  return { io: { ...base, ...over }, receipts, sent };
}

describe("executor", () => {
  it("does nothing before the open window", async () => {
    const { io: x } = io({ now: RELEASE - 3 * H });
    expect(await tick({}, x)).toEqual({});
  });

  it("opens in practice mode with a sized BTC leg", async () => {
    const { io: x, receipts } = io();
    const s = await tick({}, x);
    const h = s["2026-11-12-cpi"];
    expect(h.status).toBe("open");
    expect(h.mode).toBe("practice");
    expect(h.legs[0]).toMatchObject({ asset: "BTC", entry: 60_000 });
    expect(h.legs[0].qty).toBe(0.0833); // 50% of 0.2 BTC = $6,000, capped at $5,000, rounded down to the step
    expect(receipts.map((r) => r.kind)).toEqual(["hedge_open"]);
  });

  it("stays hedged until the number is out, then unwinds an in-line print", async () => {
    let { io: x } = io();
    let s = await tick({}, x);
    ({ io: x } = io({ now: RELEASE + 10 * 60_000, actual: null }));
    s = await tick(s, x);
    expect(s["2026-11-12-cpi"].status).toBe("open");
    const r2 = io({ now: RELEASE + 15 * 60_000, actual: 3.0, price: 59_400 });
    s = await tick(s, r2.io);
    const h = s["2026-11-12-cpi"];
    expect(h).toMatchObject({ status: "closed", closeReason: "in_line" });
    expect(h.legs[0].pnlUsd).toBeCloseTo(0.0833 * 600, 2);
    expect(r2.receipts.map((r) => r.kind)).toEqual(["release", "hedge_close"]);
  });

  it("holds through a hot print and closes at the time limit", async () => {
    let s = await tick({}, io().io);
    s = await tick(s, io({ now: RELEASE + 10 * 60_000, actual: 3.5 }).io);
    expect(s["2026-11-12-cpi"].status).toBe("holding");
    s = await tick(s, io({ now: RELEASE + 2 * H, actual: 3.5 }).io);
    expect(s["2026-11-12-cpi"].status).toBe("holding");
    s = await tick(s, io({ now: RELEASE + 6 * H, actual: 3.5 }).io);
    expect(s["2026-11-12-cpi"]).toMatchObject({ status: "closed", closeReason: "max_hold" });
  });

  it("never opens late or twice", async () => {
    expect(await tick({}, io({ now: RELEASE + 60_000 }).io)).toEqual({});
    const s = await tick({}, io().io);
    const again = await tick(s, io({ now: RELEASE - 20 * 60_000 }).io);
    expect(again["2026-11-12-cpi"].openedAt).toBe(s["2026-11-12-cpi"].openedAt);
  });

  it("refuses a live hedge on unconfirmed holdings", async () => {
    const { io: x, receipts } = io({ live: true, trusted: false });
    const s = await tick({}, x);
    expect(s["2026-11-12-cpi"].status).toBe("skipped");
    expect(receipts[0]).toMatchObject({ kind: "hedge_skipped" });
  });

  it("live: leverage, then bracket; unwind is reduce-only after cancelling stop/target", async () => {
    const sent: Action[] = [];
    const trader = {
      symbol: async (name: string) => ({ id: name === "BTC-USD" ? 1 : 2, name, pricePrecision: 1, quantityPrecision: 4, tickSize: "0.5", stepSize: "0.0001" }),
      send: async (a: Action) => {
        sent.push(a);
        if (a.type === "newOrder") return a.params.orders.map((o, k) => ({ code: 0, clOrdID: o.clOrdID, orderID: 100 + k }));
        return null;
      },
    };
    let s = await tick({}, io({ live: true, accountID: 42, trader }).io);
    expect(sent.map((a) => a.type)).toEqual(["updateLeverage", "newOrder"]);
    const bracket = sent[1];
    if (bracket.type !== "newOrder") throw new Error();
    expect(bracket.params.accountID).toBe(42);
    expect(bracket.params.orders.map((o) => [o.modifier, o.side, o.reduceOnly])).toEqual([
      [3, 2, false],
      [4, 1, true],
      [4, 1, true],
    ]);
    expect(s["2026-11-12-cpi"].legs[0].orderIDs).toEqual([100, 101, 102]);
    sent.length = 0;
    s = await tick(s, io({ live: true, accountID: 42, trader, now: RELEASE + 10 * 60_000, actual: 2.6 }).io);
    expect(s["2026-11-12-cpi"]).toMatchObject({ status: "closed", closeReason: "good_news" });
    expect(sent.map((a) => a.type)).toEqual(["cancelOrder", "newOrder"]);
    const unwind = sent[1];
    if (unwind.type !== "newOrder") throw new Error();
    expect(unwind.params.orders[0]).toMatchObject({ side: 1, reduceOnly: true });
  });

  it("live: a hot print places a break-even stop", async () => {
    const sent: Action[] = [];
    const trader = {
      symbol: async (name: string) => ({ id: 1, name, pricePrecision: 1, quantityPrecision: 4, tickSize: "0.5", stepSize: "0.0001" }),
      send: async (a: Action) => {
        sent.push(a);
        return a.type === "newOrder" ? a.params.orders.map((o) => ({ code: 0, clOrdID: o.clOrdID, orderID: 1 })) : null;
      },
    };
    let s = await tick({}, io({ live: true, accountID: 1, trader }).io);
    sent.length = 0;
    s = await tick(s, io({ live: true, accountID: 1, trader, now: RELEASE + 10 * 60_000, actual: 3.5 }).io);
    expect(s["2026-11-12-cpi"].status).toBe("holding");
    const be = sent[0];
    if (be.type !== "newOrder") throw new Error();
    expect(be.params.orders[0]).toMatchObject({ modifier: 2, side: 1, reduceOnly: true, stopType: 1, stopPrice: "60000" });
  });

  it("kill switch closes everything open", async () => {
    const s = await tick({}, io().io);
    const k = io({ now: RELEASE - 10 * 60_000 });
    const after = await killAll(s, k.io);
    expect(after["2026-11-12-cpi"]).toMatchObject({ status: "closed", closeReason: "kill_switch" });
    expect(k.receipts.map((r) => r.kind)).toEqual(["hedge_close", "kill_switch"]);
  });
});

describe("SoDEX API key registration", () => {
  const params = { accountID: 1010, name: "api-key-01", publicKey: "0x3d4595c8742d0a58173a9963c05755b59a8f8256" as Hex, expiresAt: 0 };

  it("typed data hash matches a hand port of the Go AddAPIKey struct hash", () => {
    const td = addApiKeyTypedData(params, 1760373925000, "testnet");
    const viemHash = hashTypedData({ domain: td.domain, types: { AddAPIKey: td.types.AddAPIKey }, primaryType: "AddAPIKey", message: { ...td.message, accountID: 1010n, expiresAt: 0n, nonce: 1760373925000n } });
    const domainTypeHash = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
    const sep = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [domainTypeHash, keccak256(toHex("universal")), keccak256(toHex("1")), 138565n, "0x0000000000000000000000000000000000000000"],
      ),
    );
    const typeHash = keccak256(toHex("AddAPIKey(uint64 accountID,string name,uint8 keyType,bytes publicKey,uint64 expiresAt,uint64 nonce)"));
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [typeHash, 1010n, keccak256(toHex("api-key-01")), 1n, keccak256(params.publicKey), 0n, 1760373925000n],
      ),
    );
    expect(viemHash).toBe(keccak256(concatHex(["0x1901", sep, structHash])));
  });

  it("wallet signature recovers to the wallet and gets the 0x02 universal prefix", async () => {
    const wallet = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
    const td = addApiKeyTypedData(params, 1, "testnet");
    const { EIP712Domain: _d, ...types } = td.types;
    const sig = await wallet.signTypedData({ domain: td.domain, types, primaryType: "AddAPIKey", message: td.message as any });
    expect(await recoverTypedDataAddress({ domain: td.domain, types, primaryType: "AddAPIKey", message: td.message as any, signature: sig })).toBe(wallet.address);
    const wire = universalWireSig(sig);
    expect(wire.slice(0, 4)).toBe("0x02");
    expect(wire.length).toBe(2 + 66 * 2);
    expect([0, 1]).toContain(parseInt(wire.slice(-2), 16));
  });

  it("body uses `type` and Go field order", () => {
    expect(addApiKeyBody(params)).toBe('{"accountID":1010,"name":"api-key-01","type":1,"publicKey":"0x3d4595c8742d0a58173a9963c05755b59a8f8256","expiresAt":0}');
  });
});

describe("account settings", () => {
  it("clamps anything a client sends", () => {
    const s = clampSettings({ maxRatio: 9, lev: 50, btc: -1, aggr: "x" as any, live: true });
    expect(s).toMatchObject({ maxRatio: 1, lev: 5, btc: 0, aggr: DEFAULT_SETTINGS.aggr, live: true });
  });
  it("synced balances replace typed ones per coin", () => {
    const h = effectiveHoldings({ ...DEFAULT_SETTINGS, btc: 1, eth: 5 }, { btcAddress: "bc1qxyz", btc: 0.4, at: 1 });
    expect(h).toMatchObject({ BTC: 0.4, ETH: 5, source: { BTC: "synced", ETH: "typed" } });
  });
  it("holdings are trusted when confirmed this week or fully synced today", () => {
    const now = Date.UTC(2026, 9, 20);
    const s = { ...DEFAULT_SETTINGS, btc: 1, eth: 0 };
    expect(holdingsTrusted({ settings: s, now })).toBe(false);
    expect(holdingsTrusted({ settings: s, confirmedAt: now - 2 * 86_400_000, now })).toBe(true);
    expect(holdingsTrusted({ settings: s, confirmedAt: now - 8 * 86_400_000, now })).toBe(false);
    expect(holdingsTrusted({ settings: s, sync: { btcAddress: "bc1q", btc: 1, at: now - H }, now })).toBe(true);
    expect(holdingsTrusted({ settings: s, sync: { btcAddress: "bc1q", btc: 1, at: now - 30 * H }, now })).toBe(false);
  });
});
