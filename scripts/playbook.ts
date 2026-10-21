/**
 * Live check of the data side: pull the SoSoValue macro calendar, learn a playbook per
 * upcoming event from its history + SoDEX BTC-USD hourly klines, and print the hedge plan.
 *
 *   SOSOVALUE_API_KEY=...  BTC=0.2 ETH=3  npx tsx scripts/playbook.ts
 */
import { SoSoValue } from "../src/sosovalue/client";
import { SodexPerps } from "../src/sodex/client";
import { releaseTime, releaseTimeAt, eventMeta } from "../src/engine/events";
import { buildPlaybook, toCandles, type Candle } from "../src/engine/playbook";
import { planHedge, DEFAULT_GUARDRAILS } from "../src/engine/policy";

import { ClaudeLLM, DEFAULT_MODEL } from "../src/agent/llm";
import { classifyEvent, explain, readMarket } from "../src/agent/advisors";

const H = 3_600_000;

async function hourlyCandles(sodex: SodexPerps, symbol: string, from: number, to: number): Promise<Candle[]> {
  const out: Candle[] = [];
  for (let start = from; start < to; start += 1000 * H) {
    const rows = await sodex.klines(symbol, "1h", { startTime: start, endTime: Math.min(start + 1000 * H, to), limit: 1000 });
    out.push(...toCandles(rows));
  }
  return out;
}

async function main() {
  const soso = new SoSoValue(process.env.SOSOVALUE_API_KEY ?? "");
  const sodex = new SodexPerps((process.env.SODEX_NETWORK as "testnet" | "mainnet") ?? "mainnet"); // mainnet klines have the longest history
  const holdings = { BTC: Number(process.env.BTC ?? 0.2), ETH: Number(process.env.ETH ?? 3) };

  const cal = await soso.macroCalendar();
  const now = Date.now();
  const upcoming = cal
    .flatMap((d) => d.events.map((e) => ({ date: d.date, event: e, at: releaseTime(d.date, e) })))
    .filter((x) => x.at > now && x.at < now + 14 * 24 * H)
    .sort((a, b) => a.at - b.at);
  console.log(`${upcoming.length} events in the next 14 days`);

  const marks = await sodex.markPrices();
  const px = (s: string) => Number(marks.find((m) => m.symbol === s)?.markPrice);
  const prices = { BTC: px("BTC-USD"), ETH: px("ETH-USD") };

  const candles = await hourlyCandles(sodex, "BTC-USD", now - 400 * 24 * H, now);
  console.log(`BTC-USD candles: ${candles.length} (${new Date(candles[0]?.t ?? now).toISOString().slice(0, 10)} → now)`);

  const llm = process.env.ANTHROPIC_API_KEY ? new ClaudeLLM(process.env.ANTHROPIC_API_KEY, process.env.BUFFER_MODEL || DEFAULT_MODEL) : undefined;
  console.log(llm ? `agent: ${llm.model}` : "agent: off (set ANTHROPIC_API_KEY to enable) — rules only");
  const news = await soso.featuredNews(20).catch(() => []);

  for (const u of upcoming) {
    let meta = eventMeta(u.event);
    if (!meta.timeKnown) {
      const c = await classifyEvent(llm, u.event, meta);
      meta = c.value;
      if (c.source === "agent") u.at = releaseTimeAt(u.date, meta.timeET);
    }
    const hist = await soso.eventHistory(u.event, { limit: 24 });
    const pb = buildPlaybook(u.event, hist, candles);
    const read = pb.tier === "LOW" ? undefined : await readMarket(llm, { eventLabel: meta.label, releaseAt: u.at, news });
    const plan = planHedge({
      event: u.event,
      releaseAt: u.at,
      playbook: pb,
      holdings,
      prices,
      guard: DEFAULT_GUARDRAILS,
      agent: read?.source === "agent" ? { sizeMultiplier: read.value.sizeMultiplier, note: read.value.rationale } : undefined,
    });
    const why = await explain(llm, plan, undefined, read?.value);
    console.log(`\n${new Date(u.at).toISOString()}  ${meta.label}${meta.timeKnown ? "" : " (time estimated)"}  →  ${plan.tier}`);
    if (read) console.log(`   market read (${read.source}): ${read.value.regime}, ×${read.value.sizeMultiplier}, cites ${read.value.citedIds.join(", ") || "—"}`);
    for (const r of plan.reasons) console.log("   ·", r);
    for (const l of plan.legs) console.log(`   short ${l.quantity.toFixed(5)} ${l.symbol} ($${l.notionalUsd.toFixed(0)}), SL/TP ±${(l.stopLossPct * 100).toFixed(1)}%`);
    console.log(`   ✎ ${why.value}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
