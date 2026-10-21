import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Tiny key-value store. Uses Upstash Redis over REST when KV_REST_API_URL / KV_REST_API_TOKEN
 * (or UPSTASH_REDIS_REST_URL / _TOKEN) are set — that's what Vercel's Redis integration provides.
 * Otherwise falls back to a JSON file (./.data locally, /tmp on serverless, which does not persist).
 */
export interface Store {
  readonly kind: "redis" | "file";
  readonly durable: boolean;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  /** Best-effort mutex: true if acquired. Expires after ttlMs so a crashed run can't wedge it. */
  lock(key: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

class RedisStore implements Store {
  readonly kind = "redis" as const;
  readonly durable = true;
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error ?? res.status}`);
    return body.result as T;
  }
  async get<T>(key: string) {
    const v = await this.cmd<string | null>("GET", key);
    return v == null ? null : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown) {
    await this.cmd("SET", key, JSON.stringify(value));
  }
  async del(key: string) {
    await this.cmd("DEL", key);
  }
  async sadd(key: string, member: string) {
    await this.cmd("SADD", key, member);
  }
  async smembers(key: string) {
    return (await this.cmd<string[]>("SMEMBERS", key)) ?? [];
  }
  async lock(key: string, ttlMs: number) {
    return (await this.cmd<string | null>("SET", `lock:${key}`, "1", "NX", "PX", ttlMs)) === "OK";
  }
  async unlock(key: string) {
    await this.cmd("DEL", `lock:${key}`);
  }
}

class FileStore implements Store {
  readonly kind = "file" as const;
  readonly durable: boolean;
  private file: string;
  private cache: Record<string, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor() {
    const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    this.durable = !serverless;
    this.file = path.join(serverless ? "/tmp" : path.join(process.cwd(), ".data"), "buffer-store.json");
  }
  private async load() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }
  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.cache));
    await fs.rename(tmp, this.file);
  }
  /** Serialise writes so concurrent requests can't interleave read-modify-write. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
  async get<T>(key: string) {
    const d = await this.load();
    return (d[key] as T) ?? null;
  }
  set(key: string, value: unknown) {
    return this.locked(async () => {
      (await this.load())[key] = JSON.parse(JSON.stringify(value));
      await this.save();
    });
  }
  del(key: string) {
    return this.locked(async () => {
      delete (await this.load())[key];
      await this.save();
    });
  }
  sadd(key: string, member: string) {
    return this.locked(async () => {
      const d = await this.load();
      const s = new Set((d[key] as string[]) ?? []);
      s.add(member);
      d[key] = [...s];
      await this.save();
    });
  }
  async smembers(key: string) {
    return ((await this.load())[key] as string[]) ?? [];
  }
  private locks = new Map<string, number>();
  async lock(key: string, ttlMs: number) {
    const until = this.locks.get(key);
    if (until && until > Date.now()) return false;
    this.locks.set(key, Date.now() + ttlMs);
    return true;
  }
  async unlock(key: string) {
    this.locks.delete(key);
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? new RedisStore(url, token) : new FileStore();
  return store;
}

/** For tests. */
export function setStore(s: Store | null) {
  store = s;
}
