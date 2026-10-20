import { describe, expect, it } from "vitest";
import { concatHex, encodeAbiParameters, keccak256, recoverAddress, toHex, hexToBytes, bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { payloadHash, signingJson, bodyJson } from "../src/sodex/payload";
import { signAction } from "../src/sodex/signer";
import { buildHedgeBracket, buildUnwind, roundToStep } from "../src/sodex/orders";
import type { Action } from "../src/sodex/types";

const KEY = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;

// The exact example from SoDEX docs ("perps market buy order signing payload").
const DOC_JSON =
  '{"type":"newOrder","params":{"accountID":12345,"symbolID":1,"orders":[{"clOrdID":"my-order-1","modifier":1,"side":1,"type":2,"timeInForce":3,"quantity":"0.001","reduceOnly":false,"positionSide":1}]}}';

const docAction: Action = {
  type: "newOrder",
  params: {
    accountID: 12345,
    symbolID: 1,
    // deliberately scrambled key order — canonicalizer must fix it
    orders: [{ positionSide: 1, quantity: "0.001", reduceOnly: false, timeInForce: 3, type: 2, side: 1, modifier: 1, clOrdID: "my-order-1" } as any],
  },
};

// Hand port of sodex-go-sdk-public common/types/eip712.go (DomainSeparator, ExchangeAction.Hash).
function goDigest(ph: Hex, nonce: bigint, chainId: number): Hex {
  const domainTypeHash = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  const sep = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domainTypeHash, keccak256(toHex("futures")), keccak256(toHex("1")), BigInt(chainId), "0x0000000000000000000000000000000000000000"],
    ),
  );
  const eaTypeHash = keccak256(toHex("ExchangeAction(bytes32 payloadHash,uint64 nonce)"));
  const structHash = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [eaTypeHash, ph, nonce]),
  );
  return keccak256(concatHex(["0x1901", sep, structHash]));
}

describe("payload", () => {
  it("matches the documented signing JSON byte-for-byte, regardless of input key order", () => {
    expect(signingJson(docAction)).toBe(DOC_JSON);
  });
  it("body is params only", () => {
    expect(bodyJson(docAction)).toBe(JSON.stringify(JSON.parse(DOC_JSON).params));
  });
  it("payloadHash = keccak256(compact json)", () => {
    expect(payloadHash(docAction)).toBe(keccak256(toHex(DOC_JSON)));
  });
  it("drops omitempty fields and keeps required zero-value fields", () => {
    const j = signingJson(docAction);
    expect(j).not.toContain("price");
    expect(j).toContain('"reduceOnly":false');
  });
  it("rejects numeric decimals", () => {
    const bad: Action = { type: "newOrder", params: { ...docAction.params, orders: [{ ...docAction.params.orders[0], quantity: 0.001 as any }] } } as Action;
    expect(() => signingJson(bad)).toThrow(/decimal string/);
  });
});

describe("signature", () => {
  for (const [network, chainId] of [["testnet", 138565], ["mainnet", 286623]] as const) {
    it(`${network}: 0x01-prefixed, v∈{0,1}, recovers to signer under the Go digest`, async () => {
      const nonce = 1760373925001n;
      const { headers, signer } = await signAction({ action: docAction, privateKey: KEY, network, nonce, apiKeyName: "api-key-01" });
      const wire = hexToBytes(headers["X-API-Sign"]);
      expect(wire.length).toBe(66);
      expect(wire[0]).toBe(1);
      expect([0, 1]).toContain(wire[65]);
      expect(headers["X-API-Key"]).toBe("api-key-01");
      expect(headers["X-API-Nonce"]).toBe("1760373925001");

      const digest = goDigest(payloadHash(docAction), nonce, chainId);
      const sig65 = wire.slice(1);
      sig65[64] += 27; // viem's recover wants 27/28
      const recovered = await recoverAddress({ hash: digest, signature: bytesToHex(sig65) });
      expect(recovered).toBe(signer);
      expect(signer).toBe(privateKeyToAccount(KEY).address);
    });
  }
  it("testnet and mainnet signatures differ (domain separation)", async () => {
    const a = await signAction({ action: docAction, privateKey: KEY, network: "testnet", nonce: 1n });
    const b = await signAction({ action: docAction, privateKey: KEY, network: "mainnet", nonce: 1n });
    expect(a.headers["X-API-Sign"]).not.toBe(b.headers["X-API-Sign"]);
  });
});

describe("orders", () => {
  const sym = { id: 1, name: "BTC-USD", pricePrecision: 1, quantityPrecision: 4, tickSize: "0.5", stepSize: "0.0001" };
  it("roundToStep", () => {
    expect(roundToStep(0.123456, "0.0001")).toBe("0.1234");
    expect(roundToStep(0.123401, "0.0001", "up")).toBe("0.1235");
    expect(roundToStep(70123.3, "0.5", "up")).toBe("70123.5");
    expect(roundToStep(70123.3, "0.5", "down")).toBe("70123");
    expect(roundToStep(100, "1")).toBe("100");
    expect(roundToStep(100, "10")).toBe("100");
  });
  it("hedge bracket follows the TP/SL batch rules", () => {
    const a = buildHedgeBracket({ accountID: 7, symbol: sym, quantity: 0.05, markPrice: 70000, stopLossPct: 0.03, takeProfitPct: 0.03 });
    if (a.type !== "newOrder") throw new Error();
    const [entry, sl, tp] = a.params.orders;
    expect(a.params.orders).toHaveLength(3);
    expect(entry).toMatchObject({ modifier: 3, side: 2, type: 2, timeInForce: 3, reduceOnly: false, quantity: "0.05" });
    expect(sl).toMatchObject({ modifier: 4, side: 1, reduceOnly: true, stopType: 1, triggerType: 2, stopPrice: "72100" });
    expect(tp).toMatchObject({ modifier: 4, side: 1, reduceOnly: true, stopType: 2, triggerType: 2, stopPrice: "67900" });
    expect(() => signingJson(a)).not.toThrow();
  });
  it("unwind is reduce-only buy", () => {
    const a = buildUnwind(7, sym, 0.05);
    if (a.type !== "newOrder") throw new Error();
    expect(a.params.orders[0]).toMatchObject({ side: 1, reduceOnly: true, quantity: "0.05" });
  });
});
