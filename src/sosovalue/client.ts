export const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";

export interface MacroDay {
  date: string; // YYYY-MM-DD
  events: string[];
}

export interface MacroRelease {
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  text: string;
  releaseTime: number;
  link: string;
  tags: string[];
}

export function stripHtml(s: string) {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface CacheEntry {
  at: number;
  value: unknown;
}

/**
 * Thin SoSoValue client. Responses may come bare or wrapped in {code, data}; both are handled.
 * Cached in-process: the calendar changes rarely and history changes once per release,
 * which keeps us well under the per-key rate limit.
 */
export class SoSoValue {
  private cache = new Map<string, CacheEntry>();
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private base = SOSO_BASE,
  ) {}

  private async get<T>(path: string, ttlMs: number): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const res = await this.fetchImpl(this.base + path, {
      headers: { Accept: "application/json", "x-soso-api-key": this.apiKey },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SoSoValue GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const value = (json && typeof json === "object" && "data" in json ? json.data : json) as T;
    if (json && typeof json === "object" && "code" in json && json.code !== 0 && json.code !== "0") {
      throw new Error(`SoSoValue GET ${path} → code ${json.code}: ${json.msg ?? json.message ?? ""}`);
    }
    this.cache.set(path, { at: Date.now(), value });
    return value;
  }

  macroCalendar(): Promise<MacroDay[]> {
    return this.get("/macro/events", 30 * 60_000);
  }

  async featuredNews(pageSize = 20): Promise<NewsItem[]> {
    const r = await this.get<{ list?: Array<Record<string, unknown>> }>(`/news/featured?page=1&page_size=${pageSize}`, 10 * 60_000);
    return (r.list ?? []).map((n) => ({
      id: String(n.id),
      title: String(n.title ?? ""),
      text: stripHtml(String(n.content ?? "")).slice(0, 600),
      releaseTime: Number(n.release_time),
      link: String(n.source_link ?? ""),
      tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
    }));
  }

  eventHistory(event: string, q: { start_date?: string; end_date?: string; limit?: number } = {}): Promise<MacroRelease[]> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ limit: 100, ...q })) if (v !== undefined) p.set(k, String(v));
    return this.get(`/macro/events/${encodeURIComponent(event)}/history?${p}`, 60 * 60_000);
  }
}
