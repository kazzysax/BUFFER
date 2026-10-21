import { authenticate, unauthorized } from "@/lib/server/auth";
import { runUser } from "@/lib/server/executor";
import { ensureUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Check now": run the executor for this account immediately instead of waiting for the next tick. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  await ensureUser(auth.userId);
  const r = await runUser(auth.userId);
  if (r.error) return Response.json({ error: r.error }, { status: 409 });
  return Response.json(r);
}
