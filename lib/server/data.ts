import "server-only";
import { ClaudeLLM, DEFAULT_MODEL, type LLM } from "@/src/agent/llm";
import type { DataSource } from "@/src/engine/pipeline";
import { DEFAULT_GUARDRAILS, type Guardrails, type Holdings } from "@/src/engine/policy";
import { liveSource } from "@/src/sources/live";
import { sampleSource } from "@/src/sources/sample";

let sample: { hour: number; src: DataSource } | null = null;
let live: DataSource | null = null;

export function dataSource(): DataSource {
  if (process.env.SOSOVALUE_API_KEY) return (live ??= liveSource(process.env.SOSOVALUE_API_KEY, "mainnet"));
  const hour = Math.floor(Date.now() / 3_600_000);
  if (!sample || sample.hour !== hour) sample = { hour, src: sampleSource() };
  return sample.src;
}

let llm: LLM | undefined | null = null;
export function agent(): LLM | undefined {
  if (llm === null) llm = process.env.ANTHROPIC_API_KEY ? new ClaudeLLM(process.env.ANTHROPIC_API_KEY, process.env.BUFFER_MODEL || DEFAULT_MODEL) : undefined;
  return llm;
}

const num = (v: string | null, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Holdings + guardrails from query params, clamped server-side so the API can never be asked for more risk than the UI allows. */
export function parseSettings(url: URL): { holdings: Holdings; guard: Guardrails } {
  const q = url.searchParams;
  return {
    holdings: { BTC: num(q.get("btc"), 0, 10_000, 0.2), ETH: num(q.get("eth"), 0, 100_000, 3) },
    guard: {
      ...DEFAULT_GUARDRAILS,
      maxHedgeRatio: num(q.get("maxRatio"), 0, 1, DEFAULT_GUARDRAILS.maxHedgeRatio),
      maxNotionalUsd: num(q.get("maxUsd"), 0, 1_000_000, DEFAULT_GUARDRAILS.maxNotionalUsd),
      maxLeverage: num(q.get("lev"), 1, 5, DEFAULT_GUARDRAILS.maxLeverage),
      leadMinutes: num(q.get("lead"), 15, 240, DEFAULT_GUARDRAILS.leadMinutes),
      maxHoldHours: num(q.get("hold"), 1, 24, DEFAULT_GUARDRAILS.maxHoldHours),
      aggressiveness: num(q.get("aggr"), 0, 1.5, DEFAULT_GUARDRAILS.aggressiveness),
      dryRun: q.get("live") !== "1",
    },
  };
}

export function sourceInfo() {
  return { data: process.env.SOSOVALUE_API_KEY ? "live" : "sample", agent: agent()?.model ?? null };
}
