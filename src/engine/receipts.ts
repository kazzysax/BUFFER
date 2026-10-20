import { createHash } from "node:crypto";

export interface Receipt<T = unknown> {
  seq: number;
  at: number;
  kind: string;
  data: T;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

export function hashEntry(prevHash: string, seq: number, at: number, kind: string, data: unknown) {
  return createHash("sha256").update(`${prevHash}|${seq}|${at}|${kind}|${stable(data)}`).digest("hex");
}

/** Append-only, hash-chained decision log. Any edit to a past entry breaks every later hash. */
export class ReceiptLog {
  constructor(public entries: Receipt[] = []) {}

  get head() {
    return this.entries.at(-1)?.hash ?? GENESIS;
  }

  append<T>(kind: string, data: T, at = Date.now()): Receipt<T> {
    const seq = this.entries.length;
    const prevHash = this.head;
    const r: Receipt<T> = { seq, at, kind, data, prevHash, hash: hashEntry(prevHash, seq, at, kind, data) };
    this.entries.push(r);
    return r;
  }

  verify(): { ok: true } | { ok: false; brokenAt: number } {
    let prev = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prev || e.hash !== hashEntry(prev, e.seq, e.at, e.kind, e.data)) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }
}
