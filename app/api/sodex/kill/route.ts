import { authenticate, unauthorized } from "@/lib/server/auth";
import { killUser } from "@/lib/server/executor";
import { ensureUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Kill switch: close every hedge with reduce-only orders and cancel anything resting. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  await ensureUser(auth.userId);
  try {
    const after = await killUser(auth.userId);
    return Response.json({ closed: Object.values(after).filter((h) => h.closeReason === "kill_switch").length });
  } catch (e) {
    return Response.json({ error: `Kill switch failed: ${(e as Error).message}` }, { status: 502 });
  }
}
