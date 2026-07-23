import crypto from "node:crypto";

// Server-only crypto helpers. All keying derives from AUTH_SECRET, so there's
// no extra secret to manage — but it means rotating AUTH_SECRET also
// invalidates stored 2FA secrets (users would re-enroll) and challenge tokens.

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ist nicht gesetzt.");
  return crypto.createHash("sha256").update(secret).digest();
}

/** AES-256-GCM encrypt → base64(iv | tag | ciphertext). For the TOTP secret at rest. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** SHA-256 hex — how PATs are stored (never the plaintext token). */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** HMAC-signed, expiring token used as the "password step passed" proof between
 *  /login and /login/2fa. Not a session — just a short-lived challenge. */
export function signChallenge(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const json = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifyChallenge<T = Record<string, unknown>>(token: string): T | null {
  const [json, sig] = token.split(".");
  if (!json || !sig) return null;
  const expected = crypto.createHmac("sha256", key()).update(json).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const body = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as { exp?: number };
    if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body as T;
  } catch {
    return null;
  }
}

/** New PAT plaintext, shown once. Format: zw_pat_<43 base64url chars>. */
export function generateApiToken(): string {
  return `zw_pat_${crypto.randomBytes(32).toString("base64url")}`;
}
