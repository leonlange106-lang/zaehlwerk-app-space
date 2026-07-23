import * as OTPAuth from "otpauth";

// Standard TOTP (SHA1, 6 digits, 30s) — compatible with Google Authenticator,
// 1Password, Aegis, etc.
const ISSUER = "Zählwerk";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** otpauth:// URI to encode in the enrollment QR code. */
export function otpauthUri(secretBase32: string, accountLabel: string): string {
  return totpFor(secretBase32, accountLabel).toString();
}

/** Verify a 6-digit code, allowing ±1 time step for clock drift. */
export function verifyTotp(secretBase32: string, code: string): boolean {
  const token = code.replace(/\D/g, "");
  if (token.length !== 6) return false;
  const delta = totpFor(secretBase32, "account").validate({ token, window: 1 });
  return delta !== null;
}
