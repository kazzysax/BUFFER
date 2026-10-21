import "server-only";
import { createHash } from "node:crypto";
import { ClaudeLLM, DEFAULT_MODEL, type JsonRequest, type LLM } from "@/src/agent/llm";
import type { DataSource } from "@/src/engine/pipeline";
import type { Guardrails, Holdings } from "@/src/engine/policy";
import { ensureUser, userView, type User } from "./users";
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

/**
 * Same question within 30 minutes → same answer. Keeps the executor's 5-minute ticks and page loads
 * from re-asking Claude, and keeps the agent's read stable between the plan and the trade.
 */
class CachedLLM implements LLM {
  private cache = new Map<string, { at: number; v: unknown }>();
  constructor(private inner: LLM) {}
  get model() {
    return this.inner.model;
  }
  async json<T>(req: JsonRequest<T>): Promise<T> {
    const key = createHash("sha256").update(`${req.name}|${req.system}|${req.user}`).digest("hex");
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.v as T;
    const v = await this.inner.json(req);
    this.cache.set(key, { at: Date.now(), v });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }
}

let llm: LLM | undefined | null = null;
export function agent(): LLM | undefined {
  if (llm === null) llm = process.env.ANTHROPIC_API_KEY ? new CachedLLM(new ClaudeLLM(process.env.ANTHROPIC_API_KEY, process.env.BUFFER_MODEL || DEFAULT_MODEL)) : undefined;
  return llm;
}

/** The signed-in user's stored holdings and limits — the server never takes these from the URL. */
export async function userContext(userId: string): Promise<{ holdings: Holdings; guard: Guardrails; user: User }> {
  const user = await ensureUser(userId);
  const v = userView(user);
  return { holdings: v.holdings, guard: v.guard, user };
}

export function sourceInfo() {
  return { data: process.env.SOSOVALUE_API_KEY ? "live" : "sample", agent: agent()?.model ?? null };
}
