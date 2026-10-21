import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authenticate, unauthorized } from "@/lib/server/auth";
import { canEncrypt, encrypt } from "@/lib/server/crypto";
import { appendReceipt } from "@/lib/server/executor";
import { NETWORK, lookupAccount } from "@/lib/server/sodex-account";
import { ensureUser, saveUser, userView } from "@/lib/server/users";
import { SodexPerps } from "@/src/sodex/client";

export const dynamic = "force-dynamic";

/**
 * Use an API key you already created on SoDEX (for wallets outside Privy, e.g. MetaMask).
 * Buffer checks the key is registered on that account before storing it.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  if (!canEncrypt()) return Response.json({ error: "The server needs BUFFER_ENCRYPTION_KEY set before it can hold a trading key." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { address?: string; keyName?: string; privateKey?: string };
  const address = b.address?.trim() ?? "";
  const keyName = b.keyName?.trim() ?? "";
  const pk = b.privateKey?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "Enter the wallet address that owns the SoDEX account." }, { status: 400 });
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(keyName) || keyName === "default") return Response.json({ error: "Enter the API key's name exactly as shown on SoDEX." }, { status: 400 });
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return Response.json({ error: "Enter the API key's private key (0x followed by 64 hex characters)." }, { status: 400 });

  const keyAddress = privateKeyToAccount(pk as Hex).address;
  const acct = await lookupAccount(NETWORK, address);
  if (!acct.ok) return Response.json({ error: acct.error }, { status: 409 });

  try {
    const keys = await new SodexPerps(NETWORK).apiKeys(address, keyName);
    const match = keys.find((k) => k.name === keyName);
    if (!match) return Response.json({ error: `No API key named "${keyName}" on that account.` }, { status: 404 });
    if (match.publicKey && match.publicKey.toLowerCase() !== keyAddress.toLowerCase()) {
      return Response.json({ error: "That private key doesn't belong to this API key." }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Couldn't check the key with SoDEX: ${(e as Error).message}` }, { status: 502 });
  }

  const u = await ensureUser(auth.userId);
  const next = {
    ...u,
    sodex: { network: NETWORK, address, accountID: acct.accountID, keyName, keyAddress, encKey: encrypt(pk), via: "imported" as const, connectedAt: Date.now() },
  };
  await saveUser(next);
  await appendReceipt(u.id, "sodex_connected", { network: NETWORK, accountID: acct.accountID, keyName, keyAddress, via: "imported" });
  return Response.json(userView(next));
}

export async function DELETE(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const u = await ensureUser(auth.userId);
  const next = { ...u, sodex: undefined, pending: undefined, settings: { ...u.settings, live: false } };
  await saveUser(next);
  if (u.sodex) await appendReceipt(u.id, "sodex_disconnected", { keyName: u.sodex.keyName });
  return Response.json(userView(next));
}
