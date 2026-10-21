import type { Hex } from "viem";
import { authenticate, unauthorized } from "@/lib/server/auth";
import { appendReceipt } from "@/lib/server/executor";
import { ensureUser, saveUser, userView } from "@/lib/server/users";
import { registerApiKey } from "@/src/sodex/apikey";

export const dynamic = "force-dynamic";

/** Step 2: forward the wallet's signature to SoDEX to register the trading key. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const body = (await req.json().catch(() => ({}))) as { signature?: string };
  if (!body.signature || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return Response.json({ error: "The wallet signature is missing or malformed." }, { status: 400 });

  const u = await ensureUser(auth.userId);
  const p = u.pending;
  if (!p || Date.now() - p.createdAt > 10 * 60_000) return Response.json({ error: "That connect request expired. Start again." }, { status: 410 });

  try {
    await registerApiKey({
      network: p.network,
      owner: p.address,
      params: { accountID: p.accountID, name: p.keyName, publicKey: p.keyAddress as Hex, expiresAt: 0 },
      nonce: p.nonce,
      walletSig: body.signature as Hex,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  const next = {
    ...u,
    pending: undefined,
    sodex: { network: p.network, address: p.address, accountID: p.accountID, keyName: p.keyName, keyAddress: p.keyAddress, encKey: p.encKey, via: "wallet" as const, connectedAt: Date.now() },
  };
  await saveUser(next);
  await appendReceipt(u.id, "sodex_connected", { network: p.network, accountID: p.accountID, keyName: p.keyName, keyAddress: p.keyAddress });
  return Response.json(userView(next));
}
