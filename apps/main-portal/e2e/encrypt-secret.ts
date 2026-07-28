import crypto from "node:crypto";

// AES-256-GCM, byte-for-byte what `app/lib/crypto.ts` writes into
// `User.twoFactorSecret`. Specs need it to plant a known TOTP secret and then
// compute real codes from it.
//
// **Deliberately a copy, not an import.** Pulling the app module into the test
// process meant `await import("../app/lib/crypto")` at runtime, and that broke
// with "Cannot use import statement outside a module" on CI while passing
// locally — the two resolve TypeScript differently, and a spec that only runs on
// one of them is not a check.
//
// The duplication is bounded and self-policing: if the stored format ever
// changes, every 2FA spec fails immediately and loudly, which is exactly when
// you want to hear about it.

function keyFrom(authSecret: string): Buffer {
  return crypto.createHash("sha256").update(authSecret).digest();
}

/** base64(iv | tag | ciphertext) — the layout `decryptSecret()` expects. */
export function encryptSecret(plain: string, authSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(authSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
