import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, otpauthUri, totpDriftSeconds, verifyTotp } from "./totp";

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

  it("round-trips to the same secret and standard parameters", () => {
    // What an authenticator actually does with the QR. Anything non-default
    // here is a compatibility risk with real apps, so it is pinned.
    const secret = generateTotpSecret();
    const parsed = OTPAuth.URI.parse(otpauthUri(secret, "user@example.com")) as OTPAuth.TOTP;

    expect(parsed.secret.base32).toBe(secret);
    expect(parsed.algorithm).toBe("SHA1");
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
    // The code the phone would produce must be the code this server expects.
    expect(verifyTotp(secret, parsed.generate())).toBe(true);
  });
});

// TOTP is an agreement between two clocks. When they disagree by more than half
// a minute EVERY code is refused, and "Code ist ungültig" sends people
// re-scanning forever. These pin the diagnosis that says so instead.
describe("totpDriftSeconds", () => {
  const secret = generateTotpSecret();
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });

  it("reports how far out a rejected-but-correct code was", () => {
    const code = totp.generate({ timestamp: Date.now() + 180_000 });
    expect(verifyTotp(secret, code)).toBe(false);

    const drift = totpDriftSeconds(secret, code);
    expect(drift).not.toBeNull();
    expect(Math.abs(drift as number)).toBeGreaterThanOrEqual(150);
    expect(Math.abs(drift as number)).toBeLessThanOrEqual(210);
  });

  it("signs the drift so the message can say which way the clock is off", () => {
    const behind = totpDriftSeconds(secret, totp.generate({ timestamp: Date.now() + 180_000 }));
    const ahead = totpDriftSeconds(secret, totp.generate({ timestamp: Date.now() - 180_000 }));
    expect(behind as number).toBeGreaterThan(0);
    expect(ahead as number).toBeLessThan(0);
  });

  it("returns null for a code that is simply wrong", () => {
    // Must not invent a clock problem out of a typo — that would send someone
    // reconfiguring NTP over a mistyped digit.
    //
    // The wrong code is DERIVED from the valid ones rather than picked by hand.
    // "000000" looks obviously wrong and almost always is — but the drift search
    // spans ±DRIFT_SEARCH_WINDOW steps, i.e. 41 valid codes, against a secret
    // this suite mints fresh on every run. The chance one of them really is
    // "000000" is about 41 in a million: rare enough to hide for months, common
    // enough to eventually turn CI red for no reason. It did exactly that.
    const validNow = new Set(
      Array.from({ length: 41 }, (_, i) =>
        totp.generate({ timestamp: Date.now() + (i - 20) * 30_000 }),
      ),
    );
    let candidate = 0;
    let wrong = "000000";
    while (validNow.has(wrong)) {
      candidate += 1;
      wrong = String(candidate).padStart(6, "0");
    }

    expect(totpDriftSeconds(secret, wrong)).toBeNull();
    expect(totpDriftSeconds(secret, "13")).toBeNull();
  });

  it("does not search so wide that a foreign code lands inside the window", () => {
    // Same trap as above, and a good deal likelier: 25 foreign codes against a
    // 41-step window are 1025 chances of a one-in-a-million collision — about
    // one run in a thousand.
    //
    // A collision is not what this test is about. It asks whether the window is
    // too WIDE, and a foreign code that happens to equal a genuinely valid one
    // says nothing about width — it is the birthday problem, not a bug. Such a
    // code is therefore skipped rather than counted, and the assertion still
    // fails for the thing it exists to catch: a window so wide that unrelated
    // codes routinely fall inside it.
    const validNow = new Set(
      Array.from({ length: 41 }, (_, i) =>
        totp.generate({ timestamp: Date.now() + (i - 20) * 30_000 }),
      ),
    );
    const other = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(generateTotpSecret()) });
    const falsePositives = Array.from({ length: 25 }, (_, i) =>
      other.generate({ timestamp: Date.now() + i * 30_000 }),
    )
      .filter((code) => !validNow.has(code))
      .map((code) => totpDriftSeconds(secret, code))
      .filter((drift) => drift !== null);

    expect(falsePositives).toHaveLength(0);
  });
});
