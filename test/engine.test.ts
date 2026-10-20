import { describe, expect, it } from "vitest";
import { eventMeta, releaseTime } from "../src/engine/events";
import { buildPlaybook, quantile, type Candle } from "../src/engine/playbook";
import { decideAfterRelease, planHedge, DEFAULT_GUARDRAILS } from "../src/engine/policy";
import { ReceiptLog } from "../src/engine/receipts";
import type { MacroRelease } from "../src/sosovalue/client";

describe("events", () => {
  it("maps names to metadata", () => {
    expect(eventMeta("CPI").label).toBe("CPI");
    expect(eventMeta("Core CPI YoY").label).toBe("Core CPI");
    expect(eventMeta("Nonfarm Payrolls").timeET).toBe("08:30");
    expect(eventMeta("FOMC Interest Rate Decision").timeET).toBe("14:00");
    expect(eventMeta("Something Obscure").timeKnown).toBe(false);
  });
  it("release time is DST-aware", () => {
    // 2026-03-03 is EST (UTC-5): 08:30 ET = 13:30Z
    expect(new Date(releaseTime("2026-03-03", "CPI")).toISOString()).toBe("2026-03-03T13:30:00.000Z");
    // 2026-07-15 is EDT (UTC-4): 08:30 ET = 12:30Z
    expect(new Date(releaseTime("2026-07-15", "CPI")).toISOString()).toBe("2026-07-15T12:30:00.000Z");
    // FOMC 14:00 EDT = 18:00Z
    expect(new Date(releaseTime("2026-09-16", "FOMC Rate Decision")).toISOString()).toBe("2026-09-16T18:00:00.000Z");
  });
});

// Synthetic market: flat at 100, except each release moves price by a chosen % over the window.
function synth(history: MacroRelease[], moves: number[], event: string): Candle[] {
  const H = 3_600_000;
  const releases = history.map((h) => releaseTime(h.date, event));
  const start = Math.floor(Math.min(...releases) / H) * H - 48 * H; // hourly candles open on the hour
  const end = Math.max(...releases) + 48 * H;
  const out: Candle[] = [];
  let px = 100;
  for (let t = start; t <= end; t += H) {
    const i = releases.findIndex((r) => t === Math.floor(r / H) * H + H); // first full hour after release
    if (i >= 0) px = px * (1 + moves[i]);
    out.push({ t, o: px, c: px });
  }
  return out;
}

describe("playbook", () => {
  const hist: MacroRelease[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, "0")}-14`,
    forecast: 3.0,
    actual: 3.0 + [0.3, -0.1, 0, 0.2, -0.3, 0.1, 0, 0.4, -0.2, 0.1][i],
    previous: 3.0,
  }));
  const moves = [-0.05, 0.01, 0.002, -0.03, 0.04, -0.01, 0.001, -0.06, 0.03, 0.005];

  it("learns move stats, tier, sensitivity and hit rate", () => {
    const pb = buildPlaybook("CPI", hist, synth(hist, moves, "CPI"));
    expect(pb.n).toBe(10);
    expect(pb.lowSample).toBe(false);
    expect(pb.p90AbsMove).toBeCloseTo(quantile(moves.map(Math.abs), 0.9), 6);
    expect(pb.tier).toBe("HIGH");
    expect(pb.surpriseSensitivity!).toBeGreaterThan(0); // bigger surprise → bigger move in this data
    expect(pb.riskOffHitRate).toBe(0.8); // 4 of the 5 hot prints fell (index 9 rose)
  });

  it("falls back to default tier on small samples", () => {
    const pb = buildPlaybook("CPI", hist.slice(0, 3), synth(hist.slice(0, 3), moves, "CPI"));
    expect(pb.lowSample).toBe(true);
    expect(pb.tier).toBe("HIGH");
  });

  it("skips releases with no price data", () => {
    const pb = buildPlaybook("CPI", hist, []);
    expect(pb.n).toBe(0);
  });
});

describe("policy", () => {
  const pb = { event: "CPI", label: "CPI", n: 10, medianAbsMove: 0.02, p90AbsMove: 0.05, surpriseSensitivity: 0.02, riskOffHitRate: 0.8, tier: "HIGH" as const, lowSample: false, samples: [] };
  const release = Date.UTC(2026, 10, 12, 13, 30);

  it("sizes legs by tier and caps by guardrails", () => {
    const plan = planHedge({ event: "CPI", releaseAt: release, playbook: pb, holdings: { BTC: 0.2, ETH: 3 }, prices: { BTC: 70_000, ETH: 2_500 }, guard: DEFAULT_GUARDRAILS });
    expect(plan.hedgeRatio).toBe(0.5);
    const btc = plan.legs.find((l) => l.asset === "BTC")!;
    expect(btc.notionalUsd).toBe(5_000); // 0.2*70k*0.5 = 7k → capped to 5k
    expect(btc.quantity).toBeCloseTo(5_000 / 70_000, 8);
    const eth = plan.legs.find((l) => l.asset === "ETH")!;
    expect(eth.notionalUsd).toBe(3_750);
    expect(btc.stopLossPct).toBe(0.05);
    expect(plan.openAt).toBe(release - 60 * 60_000);
    expect(plan.reasons.join(" ")).toMatch(/capped/);
  });

  it("never hedges LOW tier", () => {
    const plan = planHedge({ event: "X", releaseAt: release, playbook: { ...pb, tier: "LOW" }, holdings: { BTC: 1, ETH: 0 }, prices: { BTC: 70_000, ETH: 2_500 }, guard: DEFAULT_GUARDRAILS });
    expect(plan.skip).toBe(true);
  });

  it("post-release decisions", () => {
    const past = [0.3, -0.1, 0, 0.2, -0.3, 0.1, 0, 0.4, -0.2, 0.1];
    expect(decideAfterRelease({ event: "CPI", actual: 3.0, forecast: 3.0, pastSurprises: past }).action).toBe("UNWIND_NOW");
    expect(decideAfterRelease({ event: "CPI", actual: 3.4, forecast: 3.0, pastSurprises: past }).action).toBe("HOLD_TIGHTEN"); // hot
    expect(decideAfterRelease({ event: "CPI", actual: 2.6, forecast: 3.0, pastSurprises: past }).action).toBe("UNWIND_NOW"); // cool
    expect(decideAfterRelease({ event: "CPI", actual: null, forecast: 3.0, pastSurprises: past }).action).toBe("WAIT");
  });
});

describe("receipts", () => {
  it("chains and detects tampering", () => {
    const log = new ReceiptLog();
    log.append("plan", { a: 1 }, 1);
    log.append("order", { id: 9 }, 2);
    log.append("unwind", { id: 10 }, 3);
    expect(log.verify()).toEqual({ ok: true });
    (log.entries[1].data as { id: number }).id = 99;
    expect(log.verify()).toEqual({ ok: false, brokenAt: 1 });
  });
});
