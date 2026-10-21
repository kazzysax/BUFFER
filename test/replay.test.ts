import { describe, expect, it } from "vitest";
import { replayRelease } from "../src/engine/replay";
import { releaseTime } from "../src/engine/events";
import { DEFAULT_GUARDRAILS } from "../src/engine/policy";
import type { Candle } from "../src/engine/playbook";
import type { MacroRelease } from "../src/sosovalue/client";

const H = 3_600_000;

// 12 calm CPI releases (to learn from) + one hot print that drops BTC 6% over two hours.
const history: MacroRelease[] = Array.from({ length: 13 }, (_, i) => ({
  date: `2025-${String((i % 12) + 1).padStart(2, "0")}-1${i < 12 ? 4 : 5}`.replace(/^2025-01-15$/, "2026-01-15"),
  forecast: 3,
  actual: i < 12 ? 3 + [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1, 0.25, -0.15, 0.05, 0.3, -0.25][i] : 3.5,
  previous: 3,
}));
const hot = history[12];

function candles(): Candle[] {
  const releases = history.map((h) => releaseTime(h.date, "CPI"));
  const start = Math.floor(Math.min(...releases) / H) * H - 72 * H;
  const end = Math.max(...releases) + 72 * H;
  const out: Candle[] = [];
  let p = 60_000;
  for (let t = start; t <= end; t += H) {
    const i = releases.findIndex((r) => t > r && t <= r + 2 * H);
    if (i >= 0) p *= i === 12 ? 0.97 : 1 + (i % 2 ? 0.02 : -0.02);
    out.push({ t, o: p, c: p });
  }
  return out;
}

describe("replay", () => {
  const r = replayRelease({ event: "CPI", release: hot, history, candles: candles(), btc: 0.2, guard: DEFAULT_GUARDRAILS })!;

  it("learns only from releases before the replayed one", () => {
    expect(r.playbook.n).toBe(12);
    expect(r.playbook.samples.every((s) => s.date < hot.date)).toBe(true);
  });
  it("holds through a risk-off print and ends ahead of unhedged", () => {
    expect(r.decision.action).toBe("HOLD_TIGHTEN");
    expect(r.qty).toBeGreaterThan(0);
    expect(r.savedUsd).toBeGreaterThan(0);
    expect(r.worstHedgedUsd).toBeGreaterThan(r.worstUnhedgedUsd);
  });
  it("writes a verifiable receipt chain with dry-run order payloads", () => {
    expect(r.receipts.verify()).toEqual({ ok: true });
    const kinds = r.receipts.entries.map((e) => e.kind);
    expect(kinds).toEqual(["plan", "hedge_open", "release", "hedge_close"]);
    const open = r.receipts.entries[1].data as { payloadHash: string; body: string };
    expect(open.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.parse(open.body).orders).toHaveLength(3);
  });
});
