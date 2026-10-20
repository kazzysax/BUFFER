import { z } from "zod";

/** Anything that can return a schema-checked JSON object. Swappable for tests or another provider. */
export interface JsonRequest<T> {
  name: string;
  description: string;
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  jsonSchema: Record<string, unknown>;
}

export interface LLM {
  readonly model: string;
  json<T>(req: JsonRequest<T>): Promise<T>;
}

export const DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * Claude via the Messages API. Structured output is forced with a single tool + tool_choice,
 * then re-validated with zod — the model's reply is never trusted unchecked.
 */
export class ClaudeLLM implements LLM {
  constructor(
    private apiKey: string,
    readonly model: string = DEFAULT_MODEL,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 20_000,
  ) {}

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 800,
          system: req.system,
          tools: [{ name: req.name, description: req.description, input_schema: req.jsonSchema }],
          tool_choice: { type: "tool", name: req.name },
          messages: [{ role: "user", content: req.user }],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Claude ${res.status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
      const call = body.content?.find((c) => c.type === "tool_use" && c.name === req.name);
      if (!call) throw new Error("Claude returned no tool call");
      return req.schema.parse(call.input);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Result wrapper every advisor returns: what was decided, by whom, and whether we fell back. */
export interface Advice<T> {
  value: T;
  source: "agent" | "fallback";
  model?: string;
  error?: string;
}

export async function advise<T>(llm: LLM | undefined, run: (llm: LLM) => Promise<T>, fallback: () => T): Promise<Advice<T>> {
  if (!llm) return { value: fallback(), source: "fallback", error: "no model configured" };
  try {
    return { value: await run(llm), source: "agent", model: llm.model };
  } catch (e) {
    return { value: fallback(), source: "fallback", model: llm.model, error: (e as Error).message };
  }
}
