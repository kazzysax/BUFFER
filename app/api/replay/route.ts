import { authenticate, unauthorized } from "@/lib/server/auth";
import { dataSource, parseSettings, sourceInfo } from "@/lib/server/data";
import { eventMeta } from "@/src/engine/events";
import { replayRelease, type ReplayResult } from "@/src/engine/replay";

export const dynamic = "force-dynamic";

/** Track record: Buffer replayed on recent past releases of the big events, BTC leg only. */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const url = new URL(req.url);
  const { holdings, guard } = parseSettings(url);
  const pick = url.searchParams.get("pick");
  try {
    const src = dataSource();
    const [cal, candles] = await Promise.all([src.calendar(), src.btcCandles()]);
    const names = [...new Set(cal.flatMap((d) => d.events))];
    const now = Date.now();
    const runs: ReplayResult[] = [];
    for (const ev of names) {
      const hist = await src.history(ev);
      for (const rel of hist.slice(0, 4)) {
        const r = replayRelease({ event: ev, release: rel, history: hist, candles, btc: holdings.BTC || 0.2, guard });
        if (r && r.qty > 0 && r.closedAt < now) runs.push(r);
      }
    }
    runs.sort((a, b) => b.releaseAt - a.releaseAt);
    const recent = runs.slice(0, 10);
    const chosen = recent.find((r) => `${r.date}:${r.event}` === pick) ?? recent.find((r) => r.decision.action === "HOLD_TIGHTEN") ?? recent[0];
    return Response.json({
      ...sourceInfo(),
      summary: {
        runs: recent.length,
        netUsd: recent.reduce((a, r) => a + r.savedUsd, 0),
        cushionedUsd: recent.reduce((a, r) => a + Math.max(0, r.worstHedgedUsd - r.worstUnhedgedUsd), 0),
      },
      runs: recent.map((r) => ({
        key: `${r.date}:${r.event}`,
        label: eventMeta(r.event).label,
        date: r.date,
        tier: r.playbook.tier,
        action: r.decision.action,
        closeReason: r.closeReason,
        savedUsd: r.savedUsd,
        worstUnhedgedUsd: r.worstUnhedgedUsd,
        worstHedgedUsd: r.worstHedgedUsd,
      })),
      detail: chosen && {
        key: `${chosen.date}:${chosen.event}`,
        label: eventMeta(chosen.event).label,
        date: chosen.date,
        releaseAt: chosen.releaseAt,
        openedAt: chosen.openedAt,
        closedAt: chosen.closedAt,
        closeReason: chosen.closeReason,
        decision: chosen.decision,
        entry: chosen.entry,
        exit: chosen.exit,
        qty: chosen.qty,
        points: chosen.points,
        savedUsd: chosen.savedUsd,
        receipts: chosen.receipts.entries,
        chain: chosen.receipts.verify(),
        head: chosen.receipts.head,
      },
    });
  } catch (e) {
    return Response.json({ error: `Couldn't build the track record: ${(e as Error).message}` }, { status: 502 });
  }
}
