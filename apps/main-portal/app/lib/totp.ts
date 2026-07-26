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

// How far out a code may be and still be searched for when diagnosing a
// rejection. 20 steps = ±10 minutes, which covers ordinary clock drift on a
// container host without being so wide that a random 6-digit guess is likely to
// land inside it (it is only ever used to EXPLAIN a rejection, never to accept).
const DRIFT_SEARCH_WINDOW = 20;

/**
 * Why did a code fail?
 *
 * TOTP has exactly one interesting failure mode that is not "wrong code": the
 * two clocks disagree. When that happens every code the user will ever type is
 * rejected, and "Code ist ungültig" sends them round the loop again — re-scanning,
 * re-enrolling, doubting the app. A container host whose clock has drifted is
 * the ordinary cause, and it is invisible from inside the browser.
 *
 * So on rejection we look again with a wide window. If the code matches at an
 * offset, the codes ARE right and the server's clock is wrong — which is a
 * completely different sentence to put on screen.
 *
 * Returns the drift in seconds (positive = the server's clock is BEHIND the
 * authenticator's), or null when the code simply does not match.
 */
export function totpDriftSeconds(secretBase32: string, code: string): number | null {
  const token = code.replace(/\D/g, "");
  if (token.length !== 6) return null;
  const delta = totpFor(secretBase32, "account").validate({
    token,
    window: DRIFT_SEARCH_WINDOW,
  });
  if (delta === null) return null;
  return delta * 30;
}
