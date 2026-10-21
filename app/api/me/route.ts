import { authenticate, unauthorized } from "@/lib/server/auth";
import { getStore } from "@/lib/server/store";
import { applySettings, ensureUser, saveUser, userView } from "@/lib/server/users";
import { isBtcAddress, isEthAddress } from "@/src/account/balances";
import { canEncrypt } from "@/lib/server/crypto";
import { syncBalances } from "@/lib/server/sync";
import { NETWORK } from "@/lib/server/sodex-account";

export const dynamic = "force-dynamic";

function env() {
  const s = getStore();
  return { store: { kind: s.kind, durable: s.durable }, encryption: canEncrypt(), cron: Boolean(process.env.CRON_SECRET), network: NETWORK };
}

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  const u = await ensureUser(auth.userId);
  return Response.json({ ...userView(u), env: env() });
}

/**
 * Body (all optional):
 *   settings: Partial<Settings>
 *   profile: { email?, wallet? }      — display only; SoDEX verifies wallet ownership itself on connect
 *   confirmHoldings: true
 *   sync: { btcAddress?: string|null, ethAddress?: string|null }   — null clears
 */
export async function PUT(req: Request) {
  const auth = await authenticate(req);
  if (!auth.ok) return unauthorized(auth);
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  let u = await ensureUser(auth.userId);

  if (body.settings) {
    if (body.settings.live === true && !u.sodex) return Response.json({ error: "Connect a SoDEX account before switching to live trading." }, { status: 409 });
    u = applySettings(u, body.settings);
  }
  if (body.profile) {
    const email = typeof body.profile.email === "string" ? body.profile.email.slice(0, 200) : u.email;
    const wallet = typeof body.profile.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.profile.wallet) ? body.profile.wallet : u.wallet;
    u = { ...u, email, wallet };
  }
  if (body.confirmHoldings === true) u = { ...u, confirmedAt: Date.now() };

  let syncChanged = false;
  if (body.sync) {
    const next = { ...(u.sync ?? {}) };
    for (const [key, check, coin] of [
      ["btcAddress", isBtcAddress, "btc"],
      ["ethAddress", isEthAddress, "eth"],
    ] as const) {
      const v = body.sync[key];
      if (v === null || v === "") {
        delete next[key];
        next[coin] = null;
        syncChanged = true;
      } else if (typeof v === "string") {
        if (!check(v)) return Response.json({ error: key === "btcAddress" ? "That isn't a valid bitcoin address." : "That isn't a valid Ethereum address." }, { status: 400 });
        if (next[key] !== v.trim()) {
          next[key] = v.trim();
          next[coin] = null;
          syncChanged = true;
        }
      }
    }
    u = { ...u, sync: next };
  }
  if (syncChanged && (u.sync?.btcAddress || u.sync?.ethAddress)) u = await syncBalances(u);

  await saveUser(u);
  return Response.json({ ...userView(u), env: env() });
}
