import { SoSoValue } from "../sosovalue/client";
import { SodexPerps } from "../sodex/client";
import { toCandles, type Candle } from "../engine/playbook";
import type { DataSource } from "../engine/pipeline";

const H = 3_600_000;

/** Live data: SoSoValue for macro + news, SoDEX mainnet perps for prices and hourly BTC candles. */
export function liveSource(sosoKey: string, network: "mainnet" | "testnet" = "mainnet"): DataSource {
  const soso = new SoSoValue(sosoKey);
  const sodex = new SodexPerps(network);
  let candleCache: { at: number; v: Candle[] } | null = null;
  return {
    mode: "live",
    calendar: () => soso.macroCalendar(),
    history: (e) => soso.eventHistory(e, { limit: 24 }),
    news: () => soso.featuredNews(20),
    async btcCandles() {
      if (candleCache && Date.now() - candleCache.at < 15 * 60_000) return candleCache.v;
      const now = Date.now();
      const out: Candle[] = [];
      for (let start = now - 400 * 24 * H; start < now; start += 1000 * H) {
        out.push(...toCandles(await sodex.klines("BTC-USD", "1h", { startTime: start, endTime: Math.min(start + 1000 * H, now), limit: 1000 })));
      }
      candleCache = { at: Date.now(), v: out };
      return out;
    },
    async prices() {
      const marks = await sodex.markPrices();
      const px = (s: string) => Number(marks.find((m) => m.symbol === s)?.markPrice);
      return { BTC: px("BTC-USD"), ETH: px("ETH-USD") };
    },
  };
}
