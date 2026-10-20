/**
 * Risk check #1: can we place a perps order on SoDEX testnet?
 *
 *   SODEX_PRIVATE_KEY=0x...   key that signs (API key private key, or master wallet if no SODEX_API_KEY_NAME)
 *   SODEX_ADDRESS=0x...       master wallet address (owner of the account)
 *   SODEX_API_KEY_NAME=...    optional; the *name* of a registered API key
 *   SYMBOL=BTC-USD            optional
 *   SEND=1                    actually submit (default: dry run — prints the signed request)
 *   VMODE=eth                 optional; only if the server rejects the default v∈{0,1}
 *
 *   npx tsx scripts/test-order.ts
 */
import type { Hex } from "viem";
import { SodexPerps, SodexError } from "../src/sodex/client";
import { buildDeadMan, buildHedgeBracket } from "../src/sodex/orders";
import { MarginMode } from "../src/sodex/types";

const env = (k: string, required = true) => {
  const v = process.env[k];
  if (required && !v) throw new Error(`missing env ${k}`);
  return v;
};

async function main() {
  const pk = env("SODEX_PRIVATE_KEY") as Hex;
  const addr = env("SODEX_ADDRESS")!;
  const symbolName = env("SYMBOL", false) ?? "BTC-USD";
  const send = env("SEND", false) === "1";
  const sodex = new SodexPerps("testnet", {
    privateKey: pk,
    apiKeyName: env("SODEX_API_KEY_NAME", false),
    vMode: (env("VMODE", false) as "go" | "eth") ?? "go",
  });

  const state = await sodex.state(addr);
  const accountID = Number(state.aid);
  console.log("account", accountID, "accountValue", state.av, "balances:", JSON.stringify(state.B).slice(0, 400));
  if (!Number.isFinite(accountID)) throw new Error("no account id — has this wallet been onboarded on SoDEX testnet?");

  const [symbol] = await sodex.symbols(symbolName);
  if (!symbol) throw new Error(`symbol ${symbolName} not found`);
  const mark = Number((await sodex.markPrices(symbolName))[0]?.markPrice);
  console.log("symbol", symbol.name, "id", symbol.id, "step", symbol.stepSize, "tick", symbol.tickSize, "minNotional", symbol.minNotional, "mark", mark);

  // smallest order that clears minNotional (or 0.001 BTC-ish), with a little headroom
  const minNotional = Number(symbol.minNotional ?? 0) || 10;
  const qty = Math.max(Number(symbol.minQuantity ?? 0), (minNotional * 1.2) / mark);

  const actions = [
    { type: "updateLeverage", params: { accountID, symbolID: symbol.id, leverage: 2, marginMode: MarginMode.ISOLATED } } as const,
    buildHedgeBracket({ accountID, symbol, quantity: qty, markPrice: mark, stopLossPct: 0.03, takeProfitPct: 0.03 }),
    buildDeadMan(accountID, Date.now() + 15 * 60_000),
  ];

  for (const a of actions) {
    const p = await sodex.prepare(a);
    console.log(`\n== ${a.type} ${p.method} ${p.url}\nsigner ${p.signer}\npayloadHash ${p.payloadHash}\nbody ${p.body}`);
    if (!send) continue;
    try {
      console.log("→", JSON.stringify(await sodex.send(a)));
    } catch (e) {
      if (e instanceof SodexError) console.log("✗", e.message, JSON.stringify(e.body));
      else throw e;
    }
  }
  if (!send) console.log("\nDry run. Re-run with SEND=1 to submit.");
  else console.log("\npositions:", JSON.stringify(await sodex.positions(addr, accountID)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
