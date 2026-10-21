import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for trading-key private keys at rest.
 * Key comes from BUFFER_ENCRYPTION_KEY (any string; hashed to 32 bytes).
 */
function key(): Buffer {
  const secret = process.env.BUFFER_ENCRYPTION_KEY;
  if (!secret) throw new Error("BUFFER_ENCRYPTION_KEY is not set, so Buffer can't store trading keys.");
  return createHash("sha256").update(secret).digest();
}

export function canEncrypt() {
  return Boolean(process.env.BUFFER_ENCRYPTION_KEY);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, enc] = blob.split(".");
  if (v !== "v1") throw new Error("Unknown key format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
