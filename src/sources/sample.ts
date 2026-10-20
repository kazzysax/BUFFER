import type { MacroDay, MacroRelease, NewsItem } from "../sosovalue/client";
import { eventMeta, releaseTime } from "../engine/events";
import type { Candle } from "../engine/playbook";
import type { DataSource } from "../engine/pipeline";

/**
 * Deterministic sample market used when no API keys are set. It is synthetic — the UI labels it
 * "Sample data" everywhere — but it runs through exactly the same engine as live data.
 */

const H = 3_600_000;
const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

interface Spec {
  name: string;
  inDays: number; // next release, days from today
  everyDays: number;
  base: number; // typical forecast level
  surpriseSd: number;
  impact: number; // abs move per 1σ surprise
}

const SPECS: Spec[] = [
  { name: "Initial Jobless Claims", inDays: 2, everyDays: 7, base: 225, surpriseSd: 9, impact: 0.002 },
  { name: "CPI", inDays: 3, everyDays: 30, base: 3.0, surpriseSd: 0.12, impact: 0.022 },
  { name: "PPI", inDays: 4, everyDays: 30, base: 2.4, surpriseSd: 0.15, impact: 0.009 },
  { name: "Michigan Consumer Sentiment", inDays: 5, everyDays: 30, base: 68, surpriseSd: 2.2, impact: 0.003 },
  { name: "Retail Sales", inDays: 6, everyDays: 30, base: 0.3, surpriseSd: 0.3, impact: 0.007 },
  { name: "FOMC Rate Decision", inDays: 9, everyDays: 45, base: 4.25, surpriseSd: 0.06, impact: 0.028 },
  { name: "Nonfarm Payrolls", inDays: 11, everyDays: 30, base: 160, surpriseSd: 45, impact: 0.018 },
];

function ymd(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Skip weekends so sample dates look like real release dates. */
function weekday(ms: number) {
  const d = new Date(ms).getUTCDay();
  return d === 6 ? ms + 2 * DAY : d === 0 ? ms + DAY : ms;
}

export function sampleSource(now = Date.now()): DataSource {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const r = rng(20261030);

  // past releases per event
  const history = new Map<string, MacroRelease[]>();
  const shocks: Array<{ at: number; move: number }> = [];
  for (const s of SPECS) {
    const n = s.everyDays === 7 ? 30 : 12;
    const rows: MacroRelease[] = [];
    for (let k = n; k >= 1; k--) {
      const date = ymd(weekday(today + (s.inDays - k * s.everyDays) * DAY));
      const forecast = +(s.base + gauss(r) * s.surpriseSd * 0.6).toFixed(2);
      const z = gauss(r);
      const actual = +(forecast + z * s.surpriseSd).toFixed(2);
      rows.push({ date, forecast, actual, previous: +(forecast + gauss(r) * s.surpriseSd).toFixed(2) });
      const dir = eventMeta(s.name).riskOffWhen === "lower" ? 1 : -1; // risk-off surprise → price down
      const move = dir * z * s.impact * (0.7 + r() * 0.6) + gauss(r) * s.impact * 0.25;
      shocks.push({ at: releaseTime(date, s.name), move });
    }
    history.set(s.name, rows.reverse()); // newest first, like the API
  }

  // hourly BTC: gentle random walk + the release shocks spread over the first 2 hours
  const start = Math.floor((now - 400 * DAY) / H) * H;
  const candles: Candle[] = [];
  let px = 61_000;
  for (let t = start; t <= now; t += H) {
    let ret = gauss(r) * 0.0035 + 0.00003;
    for (const s of shocks) if (t > s.at && t <= s.at + 2 * H) ret += s.move / 2;
    const o = px;
    px = Math.max(10_000, px * (1 + ret));
    candles.push({ t, o, c: px });
  }
  const btc = candles.at(-1)!.c;

  const calendar: MacroDay[] = [];
  for (const s of SPECS) {
    for (let d = s.inDays; d <= 14; d += s.everyDays) {
      const date = ymd(weekday(today + d * DAY));
      const day = calendar.find((c) => c.date === date) ?? (calendar.push({ date, events: [] }), calendar.at(-1)!);
      day.events.push(s.name);
    }
  }

  const news: NewsItem[] = [
    { id: "s1", title: "Spot bitcoin ETFs log a third day of net outflows ahead of inflation data", text: "", releaseTime: now - 5 * H, link: "", tags: ["ETF", "BTC"] },
    { id: "s2", title: "Options desks report rising demand for short-dated downside protection", text: "", releaseTime: now - 9 * H, link: "", tags: ["BTC"] },
    { id: "s3", title: "Treasury yields edge higher as traders trim rate-cut bets", text: "", releaseTime: now - 20 * H, link: "", tags: ["Macro"] },
  ];

  return {
    mode: "sample",
    calendar: async () => calendar.sort((a, b) => a.date.localeCompare(b.date)),
    history: async (e) => history.get(e) ?? [],
    news: async () => news,
    btcCandles: async () => candles,
    prices: async () => ({ BTC: btc, ETH: btc / 27.5 }),
  };
}
