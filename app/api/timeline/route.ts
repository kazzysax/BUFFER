import { authenticate, unauthorized } from "@/lib/server/auth";
import { agent, dataSource, userContext, sourceInfo } from "@/lib/server/data";
import { buildTimeline } from "@/src/engine/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const { holdings, guard } = await userContext(auth.userId);
  try {
    const t = await buildTimeline({ src: dataSource(), llm: agent(), holdings, guard });
    return Response.json({
      ...sourceInfo(),
      prices: t.prices,
      holdings,
      guard,
      // samples are only needed on the detail page; keep the list payload small
      items: t.items.map((i) => ({ ...i, playbook: { ...i.playbook, samples: undefined } })),
    });
  } catch (e) {
    return Response.json({ error: `Couldn't load the macro calendar: ${(e as Error).message}` }, { status: 502 });
  }
}
