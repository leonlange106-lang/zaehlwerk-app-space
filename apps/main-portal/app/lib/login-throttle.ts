import { rateLimit } from "./rate-limit";

// Bremse fuer die Anmeldung.
//
// `/api/v1` ist seit langem limitiert, der Login war es nie — ausgerechnet die
// Stelle, an der ein Passwort erraten werden kann. Ein Skript konnte hier
// beliebig oft zuschlagen; die einzige Grenze war bcrypt.
//
// Rein und ohne Framework, damit die Regeln testbar bleiben: Der Aufrufer
// reicht die Kennungen herein, diese Datei entscheidet nur.

/** Versuche je Fenster. Grosszuegig genug fuer Vertipper, eng genug gegen Raten. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Der zweite Faktor bekommt ein eigenes, engeres Limit.
 *
 * Ein TOTP-Code hat eine Million Moeglichkeiten und ist 30 Sekunden gueltig —
 * bei ±20 Zeitschritten Suchfenster sind das 41 gleichzeitig akzeptierte Codes.
 * Ohne Bremse ist das in Reichweite eines Skripts, und der Angreifer hat das
 * Passwort an dieser Stelle bereits. Deshalb weniger Versuche als beim Passwort,
 * nicht mehr.
 */
export const TOTP_MAX_ATTEMPTS = 10;
export const TOTP_WINDOW_MS = 15 * 60 * 1000;

export interface ThrottleVerdict {
  allowed: boolean;
  /** Sekunden bis zum naechsten Versuch — nur gesetzt, wenn abgewiesen. */
  retryAfter: number;
}

/**
 * Zwei Kennungen, zwei Zaehler — und beide muessen passen.
 *
 * Nur nach IP zu zaehlen laesst ein Botnetz dasselbe Konto von tausend Adressen
 * aus angreifen. Nur nach Konto zu zaehlen laesst eine einzelne IP tausend
 * Konten durchprobieren und erlaubt es obendrein, ein fremdes Konto gezielt
 * auszusperren. Erst zusammen decken sie beide Richtungen ab.
 */
function checkPair(
  scope: string,
  ip: string,
  subject: string,
  limit: number,
  windowMs: number,
  peek = false,
): ThrottleVerdict {
  const byIp = rateLimit({ key: `${scope}:ip:${ip}`, limit, windowMs, peek });
  const bySubject = rateLimit({ key: `${scope}:id:${subject}`, limit, windowMs, peek });
  if (byIp.ok && bySubject.ok) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(byIp.retryAfter, bySubject.retryAfter) };
}

/** Passwortschritt. `email` bereits normalisiert. */
export function checkLoginAttempt(ip: string, email: string): ThrottleVerdict {
  return checkPair("login", ip, email, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
}

/** Zweiter Faktor. `userId`, denn an dieser Stelle steht das Konto bereits fest. */
export function checkTotpAttempt(ip: string, userId: string): ThrottleVerdict {
  return checkPair("totp", ip, userId, TOTP_MAX_ATTEMPTS, TOTP_WINDOW_MS);
}

/**
 * Nachsehen, ob die Bremse der Grund fuer eine Ablehnung war — ohne mitzuzaehlen.
 *
 * `authorize()` kann nur Benutzer oder null zurueckgeben; die Begruendung
 * entsteht danach in `diagnoseTwoFactorFailure`. Wuerde diese Nachfrage
 * mitzaehlen, sperrte sich der Nutzer durchs Fragen selbst weiter aus.
 */
export function peekTotpThrottle(ip: string, userId: string): ThrottleVerdict {
  return checkPair("totp", ip, userId, TOTP_MAX_ATTEMPTS, TOTP_WINDOW_MS, true);
}

/**
 * Absender-Kennung aus Kopfzeilen.
 *
 * Hinter Cloudflare Tunnel oder dem HA-Ingress kommt jede Anfrage von derselben
 * Adresse — ohne `X-Forwarded-For` haetten alle Nutzer EINEN gemeinsamen Zaehler,
 * und der erste Tippfehler sperrte den Rest aus.
 *
 * Der erste Eintrag ist der urspruengliche Absender. Er ist faelschbar, sofern
 * jemand direkt an den Proxy vorbei kommt — deshalb ist er nur EINE der beiden
 * Kennungen; die zweite (Konto) haelt auch dann.
 */
export function callerIdentity(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
