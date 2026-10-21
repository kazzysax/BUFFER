import { runAll } from "@/lib/server/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Executor heartbeat. Call every 5 minutes with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this automatically; a GitHub Actions schedule is included for free plans).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Set CRON_SECRET to enable the executor." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const started = Date.now();
  const results = await runAll(started);
  return Response.json({
    users: results.length,
    changed: results.reduce((a, r) => a + r.changed, 0),
    open: results.reduce((a, r) => a + r.open, 0),
    errors: results.filter((r) => r.error).map((r) => ({ user: r.userId.slice(0, 12), error: r.error })),
    ms: Date.now() - started,
  });
}
