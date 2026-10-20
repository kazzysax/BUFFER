import type { MacroDay, MacroRelease, NewsItem } from "../sosovalue/client";
import type { LLM } from "../agent/llm";
import { classifyEvent, explain, readMarket, type MarketRead } from "../agent/advisors";
import { eventMeta, releaseTimeAt, type EventMeta } from "./events";
import { buildPlaybook, type Candle, type Playbook } from "./playbook";
import { planHedge, type Guardrails, type HedgePlan, type Holdings } from "./policy";

/** Everything the pipeline needs from the outside world. Live = SoSoValue + SoDEX; sample = fixtures. */
export interface DataSource {
  readonly mode: "live" | "sample";
  calendar(): Promise<MacroDay[]>;
  history(event: string): Promise<MacroRelease[]>;
  news(): Promise<NewsItem[]>;
  btcCandles(): Promise<Candle[]>;
  prices(): Promise<Record<keyof Holdings, number>>;
}

export interface TimelineItem {
  id: string; // url-safe
  event: string;
  date: string;
  meta: EventMeta;
  releaseAt: number;
  playbook: Playbook;
  plan: HedgePlan;
  read?: { value: MarketRead; source: "agent" | "fallback"; model?: string };
  explanation: { text: string; source: "agent" | "fallback"; model?: string };
}

export function eventId(date: string, event: string) {
  return `${date}-${event.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export async function buildTimeline(opts: {
  src: DataSource;
  llm?: LLM;
  holdings: Holdings;
  guard: Guardrails;
  now?: number;
  days?: number;
  onlyId?: string;
}): Promise<{ items: TimelineItem[]; prices: Record<keyof Holdings, number>; mode: DataSource["mode"]; news: NewsItem[] }> {
  const now = opts.now ?? Date.now();
  const horizon = now + (opts.days ?? 14) * 86_400_000;
  const [cal, candles, prices, news] = await Promise.all([
    opts.src.calendar(),
    opts.src.btcCandles(),
    opts.src.prices(),
    opts.src.news().catch(() => [] as NewsItem[]),
  ]);

  const upcoming = cal
    .flatMap((d) => d.events.map((event) => ({ date: d.date, event, id: eventId(d.date, event) })))
    .filter((x) => !opts.onlyId || x.id === opts.onlyId);

  const items: TimelineItem[] = [];
  for (const u of upcoming) {
    let meta = eventMeta(u.event);
    if (!meta.timeKnown && opts.llm) meta = (await classifyEvent(opts.llm, u.event, meta)).value;
    const releaseAt = releaseTimeAt(u.date, meta.timeET);
    if (releaseAt < now - 6 * 3_600_000 || releaseAt > horizon) continue;

    const hist = await opts.src.history(u.event);
    const playbook = buildPlaybook(u.event, hist, candles);
    const read = playbook.tier === "LOW" ? undefined : await readMarket(opts.llm, { eventLabel: meta.label, releaseAt, news });
    const plan = planHedge({
      event: u.event,
      releaseAt,
      playbook,
      holdings: opts.holdings,
      prices,
      guard: opts.guard,
      agent: read?.source === "agent" ? { sizeMultiplier: read.value.sizeMultiplier, note: read.value.rationale } : undefined,
    });
    const why = await explain(opts.llm, plan, undefined, read?.value);
    items.push({
      id: u.id,
      event: u.event,
      date: u.date,
      meta,
      releaseAt,
      playbook,
      plan,
      read: read && { value: read.value, source: read.source, model: read.model },
      explanation: { text: why.value, source: why.source, model: why.model },
    });
  }
  items.sort((a, b) => a.releaseAt - b.releaseAt);
  return { items, prices, mode: opts.src.mode, news };
}
