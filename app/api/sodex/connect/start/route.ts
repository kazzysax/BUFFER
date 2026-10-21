import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authenticate, unauthorized } from "@/lib/server/auth";
import { canEncrypt, encrypt } from "@/lib/server/crypto";
import { NETWORK, lookupAccount } from "@/lib/server/sodex-account";
import { ensureUser, saveUser } from "@/lib/server/users";
import { addApiKeyTypedData } from "@/src/sodex/apikey";

export const dynamic = "force-dynamic";

/**
 * Step 1 of "Connect SoDEX": the server makes a fresh trading key (it never leaves the server),
 * and returns the AddAPIKey message for the user's own wallet to sign. Signing it lets that key
 * trade on the user's SoDEX account. It cannot withdraw.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  if (!canEncrypt()) return Response.json({ error: "The server needs BUFFER_ENCRYPTION_KEY set before it can hold a trading key." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  const address = body.address?.trim();
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "Sign in with a wallet first." }, { status: 400 });

  const acct = await lookupAccount(NETWORK, address);
  if (!acct.ok) return Response.json({ error: acct.error }, { status: 409 });

  const pk = generatePrivateKey();
  const keyAddress = privateKeyToAccount(pk).address;
  const keyName = `buffer-${Date.now().toString(36)}`;
  const nonce = Date.now();
  const params = { accountID: acct.accountID, name: keyName, publicKey: keyAddress, expiresAt: 0 };

  const u = await ensureUser(auth.userId);
  await saveUser({ ...u, pending: { network: NETWORK, address, accountID: acct.accountID, keyName, keyAddress, encKey: encrypt(pk), nonce, createdAt: Date.now() } });

  return Response.json({ network: NETWORK, accountID: acct.accountID, keyName, keyAddress, typedData: addApiKeyTypedData(params, nonce, NETWORK) });
}
