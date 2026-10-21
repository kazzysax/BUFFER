import "server-only";
import { buildPlaybook } from "@/src/engine/playbook";
import { planHedge } from "@/src/engine/policy";
import { eventMeta, releaseTime } from "@/src/engine/events";
import type { TimelineItem } from "@/src/engine/pipeline";
import type { PerpsSymbol } from "@/src/sodex/client";
import { holdingsTrusted } from "@/src/account/settings";
import { killAll, tick, type ExecIO, type HedgeState, type Trader } from "@/src/engine/executor";
import { buildTimeline } from "@/src/engine/pipeline";
import { hashEntry, type Receipt } from "@/src/engine/receipts";
import { SodexPerps } from "@/src/sodex/client";
import { agent, dataSource } from "./data";
import { tradingClient } from "./sodex-account";
import { getStore } from "./store";
import { listUserIds, getUser, saveUser, userView, type User } from "./users";
import { syncBalances } from "./sync";

const GENESIS = "0".repeat(64);
const rk = (id: string) => `receipts:${id}`;
const hk = (id: string) => `hedges:${id}`;

// ── receipts (hash-chained, per user)

export async function getReceipts(userId: string): Promise<Receipt[]> {
  return (await getStore().get<Receipt[]>(rk(userId))) ?? [];
}

export async function appendReceipt(userId: string, kind: string, data: Record<string, unknown>, at = Date.now()) {
  const st = getStore();
  const list = (await st.get<Receipt[]>(rk(userId))) ?? [];
  const prevHash = list.at(-1)?.hash ?? GENESIS;
  const seq = list.length;
  const clean = JSON.parse(JSON.stringify(data)); // drop undefined so the hash matches what's stored
  list.push({ seq, at, kind, data: clean, prevHash, hash: hashEntry(prevHash, seq, at, kind, clean) });
  await st.set(rk(userId), list);
}

// ── hedge state

export async function getHedges(userId: string): Promise<Record<string, HedgeState>> {
  return (await getStore().get<Record<string, HedgeState>>(hk(userId))) ?? {};
}

async function saveHedges(userId: string, h: Record<string, HedgeState>) {
  await getStore().set(hk(userId), h);
}

// ── IO wiring

const symbolCache = new Map<string, { at: number; v: PerpsSymbol[] }>();
function liveTrader(u: User): Trader | undefined {
  if (!u.sodex) return undefined;
  const client = tradingClient(u.sodex);
  const network = u.sodex.network;
  return {
    async symbol(name) {
      const c = symbolCache.get(network);
      const list = c && Date.now() - c.at < 3_600_000 ? c.v : await new SodexPerps(network).symbols();
      symbolCache.set(network, { at: Date.now(), v: list });
      const s = list.find((x) => x.name === name);
      if (!s) throw new Error(`${name} isn't listed on SoDEX ${network}.`);
      return s;
    },
    send: (a) => client.send(a),
  };
}

async function buildIO(u: User, now: number): Promise<ExecIO> {
  const v = userView(u, now);
  const src = dataSource();
  const t = await buildTimeline({ src, llm: agent(), holdings: v.holdings, guard: v.guard, now });
  const live = Boolean(u.settings.live && u.sodex);
  const marksNetwork = live ? u.sodex!.network : "mainnet";
  return {
    now,
    items: t.items,
    guard: v.guard,
    live,
    trusted: v.holdingsTrusted,
    accountID: live ? u.sodex!.accountID : 0,
    async marks() {
      if (!live && src.mode === "sample") {
        const p = await src.prices();
        return { "BTC-USD": p.BTC, "ETH-USD": p.ETH };
      }
      const rows = await new SodexPerps(marksNetwork).markPrices();
      return Object.fromEntries(rows.map((r) => [String(r.symbol), Number(r.markPrice)]));
    },
    async release(event, date) {
      return (await src.history(event)).find((h) => h.date === date) ?? null;
    },
    async pastSurprises(event, before) {
      return (await src.history(event)).filter((h) => h.date < before && h.actual != null && h.forecast != null).map((h) => h.actual! - h.forecast!);
    },
    trader: live ? liveTrader(u) : undefined,
    receipt: (kind, data, at) => appendReceipt(u.id, kind, data, at ?? now),
  };
}

// ── entry points

export interface RunResult {
  userId: string;
  changed: number;
  open: number;
  error?: string;
}

export async function runUser(userId: string, now = Date.now()): Promise<RunResult> {
  const st = getStore();
  if (!(await st.lock(`run:${userId}`, 120_000))) return { userId, changed: 0, open: 0, error: "A run for this account is already in progress." };
  try {
    let u = await getUser(userId);
    if (!u) return { userId, changed: 0, open: 0, error: "Unknown user." };
    // keep synced balances fresh before sizing anything
    if ((u.sync?.btcAddress || u.sync?.ethAddress) && (!u.sync.at || now - u.sync.at > 30 * 60_000)) {
      u = await syncBalances(u);
      await saveUser(u);
    }
    const before = await getHedges(userId);
    const after = await tick(before, await buildIO(u, now));
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).length;
    if (changed) await saveHedges(userId, after);
    const open = Object.values(after).filter((h) => h.status === "open" || h.status === "holding").length;
    return { userId, changed, open };
  } catch (e) {
    return { userId, changed: 0, open: 0, error: (e as Error).message };
  } finally {
    await st.unlock(`run:${userId}`);
  }
}

export async function runAll(now = Date.now()) {
  const ids = await listUserIds();
  const results: RunResult[] = [];
  for (const id of ids) results.push(await runUser(id, now));
  return results;
}

export async function killUser(userId: string, now = Date.now()) {
  const st = getStore();
  // the kill switch waits briefly for an in-flight run instead of being refused
  for (let i = 0; i < 10 && !(await st.lock(`run:${userId}`, 120_000)); i++) await new Promise((r) => setTimeout(r, 500));
  try {
    const u = await getUser(userId);
    if (!u) throw new Error("Unknown user.");
    const io = await buildIO(u, now);
    const after = await killAll(await getHedges(userId), io);
    await saveHedges(userId, after);
    // belt and braces in live mode: cancel anything else still resting on the account
    if (io.live && u.sodex) {
      const client = tradingClient(u.sodex);
      const raw = await new SodexPerps(u.sodex.network).openOrders(u.sodex.address, u.sodex.accountID).catch(() => []);
      const orders = Array.isArray(raw) ? raw : (raw.orders ?? []);
      const cancels = orders
        .map((o) => ({ symbolID: Number(o.symbolID ?? o.symbol_id), orderID: Number(o.orderID ?? o.orderId ?? o.id) }))
        .filter((c) => Number.isFinite(c.symbolID) && Number.isFinite(c.orderID));
      if (cancels.length) await client.send({ type: "cancelOrder", params: { accountID: u.sodex.accountID, cancels } }).catch(() => undefined);
    }
    return after;
  } finally {
    await st.unlock(`run:${userId}`);
  }
}

export function trustedNow(u: User) {
  return holdingsTrusted({ settings: u.settings, sync: u.sync, confirmedAt: u.confirmedAt });
}

// ── practice drill: the real executor, on a clock rewound to the latest risky release


const DRILL_EVENTS = ["CPI", "Core CPI", "Nonfarm Payrolls", "FOMC Rate Decision", "PPI", "PCE", "Core PCE"];

/**
 * Runs the exact live state machine (open → read the number → hold or unwind → close) against the
 * most recent past release of a risky event, with prices from history. Always practice mode.
 * Lets anyone watch a full hedge cycle without waiting for the next CPI.
 */
export async function runDrill(userId: string) {
  const u = await getUser(userId);
  if (!u) throw new Error("Unknown user.");
  const v = userView(u);
  const src = dataSource();
  const [cal, candles] = await Promise.all([src.calendar(), src.btcCandles()]);
  const names = [...new Set([...cal.flatMap((d) => d.events), ...DRILL_EVENTS])];
  const now = Date.now();

  // Prefer the big releases (CPI, jobs, Fed), then HIGH over MEDIUM, then the most recent.
  const rank = (name: string, tier: string) => (DRILL_EVENTS.includes(eventMeta(name).label) ? 2 : 0) + (tier === "HIGH" ? 1 : 0);
  let pick: { item: TimelineItem; history: Awaited<ReturnType<typeof src.history>>; score: number } | null = null;
  for (const name of names) {
    const hist = await src.history(name).catch(() => []);
    for (const rel of hist.slice(0, 3)) {
      if (rel.actual == null || rel.forecast == null) continue;
      const at = releaseTime(rel.date, name);
      if (at > now - v.guard.maxHoldHours * 3_600_000) continue;
      const prior = hist.filter((h) => h.date < rel.date);
      const pb = buildPlaybook(name, prior, candles.filter((c) => c.t < at - 2 * 3_600_000));
      if (pb.tier === "LOW") continue;
      const score = rank(name, pb.tier) * 1e13 + at;
      if (pick && score <= pick.score) continue;
      const px = candles.find((c) => c.t <= at - v.guard.leadMinutes * 60_000 && at - v.guard.leadMinutes * 60_000 - c.t < 3_600_000)?.o;
      if (!px) continue;
      const plan = planHedge({ event: name, releaseAt: at, playbook: pb, holdings: v.holdings.BTC || v.holdings.ETH ? v.holdings : { BTC: 0.2, ETH: 0 }, prices: { BTC: px, ETH: px / 27.5 }, guard: v.guard });
      plan.legs = plan.legs.filter((l) => l.asset === "BTC"); // only BTC has full price history here
      if (plan.skip || !plan.legs.length) continue;
      pick = { item: { id: `drill-${rel.date}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, event: name, date: rel.date, meta: eventMeta(name), releaseAt: at, playbook: pb, plan, explanation: { text: "", source: "fallback" } }, history: hist, score };
    }
  }
  if (!pick) throw new Error("No past risky release with enough price history to drill on yet.");

  const { item, history } = pick;
  const priceAt = (t: number) => candles.find((c) => c.t <= t && t - c.t < 3_600_000)?.o ?? candles.filter((c) => c.t <= t).at(-1)?.o ?? 0;
  const mk = (t: number): ExecIO => ({
    now: t,
    items: [item],
    guard: { ...v.guard, dryRun: true },
    live: false,
    trusted: true,
    accountID: 0,
    marks: async () => ({ "BTC-USD": priceAt(t), "ETH-USD": priceAt(t) / 27.5 }),
    release: async (_e, date) => history.find((h) => h.date === date) ?? null,
    pastSurprises: async (_e, before) => history.filter((h) => h.date < before && h.actual != null && h.forecast != null).map((h) => h.actual! - h.forecast!),
    receipt: (kind, data) => appendReceipt(userId, kind, { ...data, drill: true }, t),
  });

  const all = await getHedges(userId);
  delete all[item.id];
  let st: Record<string, HedgeState> = {};
  st = await tick(st, mk(item.plan.openAt));
  st = await tick(st, mk(item.releaseAt + 10 * 60_000));
  if (st[item.id]?.status === "holding" || st[item.id]?.status === "open") st = await tick(st, mk(item.plan.closeBy));
  const done = { ...st[item.id], note: "Practice drill on a past release." };
  await saveHedges(userId, { ...all, [item.id]: done });
  return done;
}
