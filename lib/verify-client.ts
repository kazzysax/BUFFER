// Browser re-implementation of src/engine/receipts.ts hashing, so the chain can be checked client-side.
import type { Receipt } from "@/src/engine/receipts";

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

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyChain(entries: Receipt[]): Promise<{ ok: true } | { ok: false; brokenAt: number }> {
  let prev = GENESIS;
  for (const e of entries) {
    const h = await sha256hex(`${prev}|${e.seq}|${e.at}|${e.kind}|${stable(e.data)}`);
    if (e.prevHash !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
