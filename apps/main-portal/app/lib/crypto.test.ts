import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateApiToken,
  hashToken,
  signChallenge,
  verifyChallenge,
} from "./crypto";

describe("encryptSecret / decryptSecret (TOTP secret at rest)", () => {
  it("round-trips a value through AES-256-GCM", () => {
    const plain = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("produces a fresh IV each time, so ciphertext differs for equal input", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (GCM auth tag fails)", () => {
    const encrypted = encryptSecret("secret");
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
});

describe("hashToken (PAT storage)", () => {
  it("is deterministic and returns a 64-char hex SHA-256", () => {
    const token = "zw_pat_example";
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });

  it("never returns the plaintext and differs per input", () => {
    expect(hashToken("a")).not.toBe("a");
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("generateApiToken", () => {
  it("emits the zw_pat_ prefix and high-entropy body", () => {
    const token = generateApiToken();
    expect(token.startsWith("zw_pat_")).toBe(true);
    // base64url of 32 random bytes ≈ 43 chars.
    expect(token.length).toBeGreaterThanOrEqual(7 + 40);
    expect(generateApiToken()).not.toBe(generateApiToken());
  });
});

describe("signChallenge / verifyChallenge (2FA step proof)", () => {
  it("verifies a freshly signed payload and returns its claims", () => {
    const token = signChallenge({ sub: "user-123" }, 300);
    const payload = verifyChallenge<{ sub: string }>(token);
    expect(payload?.sub).toBe("user-123");
  });

  it("rejects a tampered payload (HMAC mismatch)", () => {
    const token = signChallenge({ sub: "user-123" }, 300);
    const [body] = token.split(".");
    const forged = `${body}.deadbeef`;
    expect(verifyChallenge(forged)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyChallenge("no-dot")).toBeNull();
    expect(verifyChallenge("")).toBeNull();
  });

  it("rejects an expired challenge", () => {
    const token = signChallenge({ sub: "x" }, -1); // already expired
    expect(verifyChallenge(token)).toBeNull();
  });
});
