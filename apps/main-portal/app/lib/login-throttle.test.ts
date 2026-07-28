import { beforeEach, describe, expect, it } from "vitest";
import {
  LOGIN_MAX_ATTEMPTS,
  TOTP_MAX_ATTEMPTS,
  callerIdentity,
  checkLoginAttempt,
  checkTotpAttempt,
  peekTotpThrottle,
} from "./login-throttle";
import { __resetRateLimits } from "./rate-limit";

beforeEach(() => {
  __resetRateLimits();
});

describe("Passwortschritt", () => {
  it("laesst Vertipper durch und bremst erst danach", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(checkLoginAttempt("1.1.1.1", "a@b.c").allowed).toBe(true);
    }
    const blocked = checkLoginAttempt("1.1.1.1", "a@b.c");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("sperrt das Konto auch, wenn die Adressen wechseln", () => {
    // Ein Botnetz umgeht eine reine IP-Zaehlung, indem es dieselbe Anmeldung von
    // vielen Adressen aus versucht. Der Konto-Zaehler haelt trotzdem.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(checkLoginAttempt(`10.0.0.${i}`, "opfer@b.c").allowed).toBe(true);
    }
    expect(checkLoginAttempt("10.0.0.99", "opfer@b.c").allowed).toBe(false);
  });

  it("sperrt die Adresse auch, wenn die Konten wechseln", () => {
    // Die Gegenrichtung: eine IP, die viele Konten durchprobiert.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(checkLoginAttempt("9.9.9.9", `konto${i}@b.c`).allowed).toBe(true);
    }
    expect(checkLoginAttempt("9.9.9.9", "noch-eins@b.c").allowed).toBe(false);
  });

  it("haelt fremde Konten auseinander", () => {
    // Sonst koennte man ein fremdes Konto gezielt aussperren, indem man sein
    // eigenes vollmacht.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i += 1) checkLoginAttempt("1.1.1.1", "angreifer@b.c");
    expect(checkLoginAttempt("2.2.2.2", "unbeteiligt@b.c").allowed).toBe(true);
  });
});

describe("Zweiter Faktor", () => {
  it("bremst enger als der Passwortschritt", () => {
    // Wer hier ankommt, hat das Passwort bereits. Ein TOTP-Code hat eine
    // Million Moeglichkeiten, und das Suchfenster akzeptiert 41 gleichzeitig.
    expect(TOTP_MAX_ATTEMPTS).toBeLessThan(LOGIN_MAX_ATTEMPTS * 3);
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i += 1) {
      expect(checkTotpAttempt("1.1.1.1", "user-1").allowed).toBe(true);
    }
    expect(checkTotpAttempt("1.1.1.1", "user-1").allowed).toBe(false);
  });

  it("peek zaehlt NICHT mit", () => {
    // Der Kern: Die Diagnose laeuft nach jeder Ablehnung. Wuerde sie mitzaehlen,
    // haette jeder Fehlversuch doppelt gezaehlt und der Nutzer sich durchs
    // Nachfragen selbst ausgesperrt.
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i += 1) {
      checkTotpAttempt("1.1.1.1", "user-2");
      expect(peekTotpThrottle("1.1.1.1", "user-2").allowed).toBe(true);
    }
    expect(peekTotpThrottle("1.1.1.1", "user-2").allowed).toBe(true);
    expect(checkTotpAttempt("1.1.1.1", "user-2").allowed).toBe(false);
    expect(peekTotpThrottle("1.1.1.1", "user-2").allowed).toBe(false);
  });
});

describe("callerIdentity", () => {
  it("nimmt den urspruenglichen Absender aus X-Forwarded-For", () => {
    // Hinter Cloudflare Tunnel kommt jede Anfrage von derselben Adresse — ohne
    // diesen Kopf haetten alle Nutzer einen gemeinsamen Zaehler.
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 172.16.0.1" });
    expect(callerIdentity(h)).toBe("203.0.113.7");
  });

  it("faellt auf X-Real-IP zurueck und sonst auf 'unknown'", () => {
    expect(callerIdentity(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(callerIdentity(new Headers())).toBe("unknown");
  });
});
