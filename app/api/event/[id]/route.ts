import { authenticate, unauthorized } from "@/lib/server/auth";
import { agent, dataSource, parseSettings, sourceInfo } from "@/lib/server/data";
import { buildTimeline } from "@/src/engine/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const { id } = await ctx.params;
  const { holdings, guard } = parseSettings(new URL(req.url));
  try {
    const src = dataSource();
    const t = await buildTimeline({ src, llm: agent(), holdings, guard, onlyId: id });
    const item = t.items[0];
    if (!item) return Response.json({ error: "That event isn't in the next 14 days." }, { status: 404 });
    const history = await src.history(item.event);
    return Response.json({ ...sourceInfo(), prices: t.prices, item, history: history.slice(0, 12), news: t.news.slice(0, 8) });
  } catch (e) {
    return Response.json({ error: `Couldn't load this event: ${(e as Error).message}` }, { status: 502 });
  }
}
