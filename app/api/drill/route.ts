import { authenticate, unauthorized } from "@/lib/server/auth";
import { runDrill } from "@/lib/server/executor";
import { ensureUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Practice drill: watch one full hedge cycle on the latest risky release. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  await ensureUser(auth.userId);
  try {
    return Response.json({ hedge: await runDrill(auth.userId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
