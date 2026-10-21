import { authenticate, unauthorized } from "@/lib/server/auth";
import { getHedges, getReceipts } from "@/lib/server/executor";
import { ensureUser, userView } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** The signed-in user's real hedges (practice or live) and their receipt chain. */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const u = await ensureUser(auth.userId);
  const [hedges, receipts] = await Promise.all([getHedges(u.id), getReceipts(u.id)]);
  const list = Object.values(hedges).sort((a, b) => b.releaseAt - a.releaseAt);
  return Response.json({ ...userView(u), hedges: list, receipts, cron: Boolean(process.env.CRON_SECRET) });
}
