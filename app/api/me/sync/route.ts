import { authenticate, unauthorized } from "@/lib/server/auth";
import { syncBalances } from "@/lib/server/sync";
import { ensureUser, saveUser, userView } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  let u = await ensureUser(auth.userId);
  if (!u.sync?.btcAddress && !u.sync?.ethAddress) return Response.json({ error: "Add a wallet address to sync first." }, { status: 400 });
  u = await syncBalances(u);
  await saveUser(u);
  return Response.json(userView(u));
}
