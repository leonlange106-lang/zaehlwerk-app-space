import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

function currentCode(secretBase32: string): string {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

describe("generateTotpSecret", () => {
  it("returns a base32 secret usable by standard authenticators", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });
});

describe("verifyTotp", () => {
  it("accepts the current valid code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, currentCode(secret))).toBe(true);
  });

  it("tolerates codes with spaces/formatting", () => {
    const secret = generateTotpSecret();
    const code = currentCode(secret);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced)).toBe(true);
  });

  it("rejects a wrong or wrongly-sized code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false); // too short
    expect(verifyTotp(secret, "")).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("builds an otpauth:// URI carrying the issuer and account", () => {
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, "user@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Z");
    expect(uri).toContain(encodeURIComponent(secret).slice(0, 6));
  });
});
