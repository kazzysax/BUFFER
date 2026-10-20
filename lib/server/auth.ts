import "server-only";
import { importSPKI, jwtVerify } from "jose";

export type AuthResult = { ok: true; userId: string; mode: "privy" | "preview" } | { ok: false; status: number; error: string };

let keyPromise: Promise<CryptoKey> | null = null;

export function privyConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_VERIFICATION_KEY);
}

/**
 * Verifies the Privy access token sent as `Authorization: Bearer <token>`.
 * With no Privy keys configured the app runs in preview mode and every request is the preview user.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  if (!privyConfigured()) return { ok: true, userId: "preview", mode: "preview" };
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { ok: false, status: 401, error: "Sign in to continue." };
  try {
    keyPromise ??= importSPKI(process.env.PRIVY_VERIFICATION_KEY!.replace(/\\n/g, "\n"), "ES256");
    const { payload } = await jwtVerify(token, await keyPromise, { issuer: "privy.io", audience: process.env.NEXT_PUBLIC_PRIVY_APP_ID });
    if (!payload.sub) return { ok: false, status: 401, error: "Session token has no user." };
    return { ok: true, userId: payload.sub, mode: "privy" };
  } catch {
    return { ok: false, status: 401, error: "Your session expired. Sign in again." };
  }
}

export function unauthorized(r: Extract<AuthResult, { ok: false }>) {
  return Response.json({ error: r.error }, { status: r.status });
}
