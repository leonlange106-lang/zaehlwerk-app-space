"use server";

import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@zaehlwerk/database";
import { CHALLENGE_COOKIE, CHALLENGE_TTL_SECONDS, isSecureConnection } from "./auth-constants";
import { decryptSecret, signChallenge, verifyChallenge } from "./crypto";
import { getSessionUser } from "./auth-helpers";
import { totpDriftSeconds, verifyTotp } from "./totp";
import type { ActionState } from "./action-state";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { callerIdentity, checkLoginAttempt, peekTotpThrottle } from "./login-throttle";

const BCRYPT_ROUNDS = 12;

export type LoginPrecheck = {
  ok: boolean;
  twoFactorRequired?: boolean;
  /** Temp-password account: log in without a password, then set one. */
  mustSetPassword?: boolean;
  /**
   * Zu viele Versuche. Bewusst UNTERSCHIEDEN von `ok: false`.
   *
   * Beides als "falsche Zugangsdaten" auszugeben waere dieselbe Sackgasse, die
   * `diagnoseTwoFactorFailure` beim zweiten Faktor aufloest: Wer richtig tippt
   * und trotzdem abgewiesen wird, tippt es noch zehnmal. Die Sperre verraet
   * nichts — sie gilt fuer existierende wie nicht existierende Konten gleich.
   */
  lockedOut?: boolean;
  /** Sekunden bis zum naechsten Versuch. Nur bei `lockedOut`. */
  retryAfter?: number;
};

/**
 * First login step: verify email + password WITHOUT issuing a session. If the
 * user has 2FA on, set a short-lived signed challenge cookie and tell the client
 * to continue at /login/2fa; otherwise the client proceeds straight to signIn().
 * Returns only a boolean either way — never leaks whether the email exists.
 *
 * Temp-password accounts (mustSetPassword) are a special case: the first login
 * needs no password — we report `mustSetPassword` so the client issues a
 * passwordless session and routes to /set-password.
 */
export async function beginLoginAction(email: string, password: string): Promise<LoginPrecheck> {
  const normalized = String(email).trim().toLowerCase();

  // Bremse VOR der Datenbank: Ein abgewiesener Versuch soll nichts kosten und
  // nichts verraten — insbesondere nicht ueber die Antwortzeit, ob das Konto
  // existiert. bcrypt.compare ist absichtlich langsam; ein Angreifer haette es
  // sonst als Zeitorakel.
  const caller = callerIdentity(await headers());
  const verdict = checkLoginAttempt(caller, normalized);
  if (!verdict.allowed) {
    void recordAuditEvent(AUDIT_ACTIONS.loginBlocked, normalized, `IP ${caller}`);
    return { ok: false, lockedOut: true, retryAfter: verdict.retryAfter };
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    void recordAuditEvent(AUDIT_ACTIONS.loginFailed, normalized, `IP ${caller} (unbekannt)`);
    return { ok: false };
  }

  // Temp-password account → passwordless first login (no bcrypt check).
  if (user.mustSetPassword) {
    return { ok: true, mustSetPassword: true };
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    void recordAuditEvent(AUDIT_ACTIONS.loginFailed, normalized, `IP ${caller}`);
    return { ok: false };
  }

  if (user.twoFactorEnabled) {
    const token = signChallenge({ sub: user.id }, CHALLENGE_TTL_SECONDS);
    (await cookies()).set(CHALLENGE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Read off the connection, NOT NODE_ENV — see isSecureConnection(). Getting
      // this wrong makes the browser drop the cookie in silence and every code
      // on the next screen comes back "ungültig".
      secure: isSecureConnection(await headers()),
      maxAge: CHALLENGE_TTL_SECONDS,
      path: "/",
    });
    return { ok: true, twoFactorRequired: true };
  }

  return { ok: true, twoFactorRequired: false };
}

/**
 * Why was the second factor refused?
 *
 * Auth.js's Credentials provider can only answer yes or no — `authorize()`
 * returns a user or null, and every reason collapses into the same
 * CredentialsSignin. So /login/2fa had exactly one sentence for four different
 * situations, and the least likely of them ("your code is wrong") was the one it
 * printed. That is how a dropped challenge cookie masqueraded as a bad code for
 * an entire release: the codes were always right.
 *
 * This runs only after a rejection and never issues a session. It is reachable
 * only with a valid challenge cookie — i.e. the password was already proven — so
 * it tells the holder of that password nothing they could not learn by enrolling,
 * where the same drift message already lives.
 */
export async function diagnoseTwoFactorFailure(code: string): Promise<string> {
  const GENERIC = "Code ist ungültig. Bitte erneut versuchen.";
  const RESTART =
    "Die Anmeldung ist abgelaufen. Bitte melde dich mit E-Mail und Passwort erneut an.";

  try {
    const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value;
    if (!challenge) {
      // The cookie is not merely expired — it never arrived. Over plain HTTP a
      // `secure` cookie is discarded by the browser without any error, which is
      // the bug this whole path was built to name instead of hide.
      return isSecureConnection(await headers())
        ? RESTART
        : "Die Anmeldung wurde nicht gespeichert: der Browser hat das Sitzungs-Cookie verworfen. " +
            "Rufe die App über die gleiche Adresse auf, unter der du dich angemeldet hast, " +
            "und erlaube Cookies für diese Seite.";
    }

    const payload = verifyChallenge<{ sub?: string }>(challenge);
    if (!payload?.sub) return RESTART;

    // Zuerst die Bremse — sie ist der einzige Ablehnungsgrund, bei dem auch ein
    // vollkommen richtiger Code scheitert. Das zu verschweigen waere genau die
    // Sackgasse, die diese Funktion aufloesen soll. `peek`, nicht `check`: Eine
    // Nachfrage darf den Zaehler nicht weiterdrehen.
    const throttle = peekTotpThrottle(callerIdentity(await headers()), payload.sub);
    if (!throttle.allowed) {
      const minutes = Math.max(1, Math.round(throttle.retryAfter / 60));
      return `Zu viele Versuche. Bitte in etwa ${minutes} Minute(n) erneut versuchen.`;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) return RESTART;

    const secret = decryptSecret(user.twoFactorSecret);
    if (verifyTotp(secret, code)) {
      // It verifies here but not in authorize() — nothing sensible left to say,
      // and claiming the code is wrong would be a lie.
      return "Die Bestätigung ist fehlgeschlagen. Bitte erneut versuchen.";
    }

    // Look again with a wide window before blaming the user. A code that lands
    // at an offset means their authenticator is right and this server's clock is
    // wrong — every code will fail until the host's time is fixed, and no amount
    // of re-entering will help.
    const drift = totpDriftSeconds(secret, code);
    if (drift !== null && drift !== 0) {
      const minutes = Math.round(Math.abs(drift) / 60);
      const amount = minutes >= 1 ? `${minutes} Minute(n)` : `${Math.abs(drift)} Sekunden`;
      const direction = drift > 0 ? "nach" : "vor";
      return (
        `Der Code stimmt, aber die Uhr dieses Servers geht ${amount} ${direction}. ` +
        `Serverzeit: ${new Date().toLocaleString("de-DE")}. ` +
        "Zeitsynchronisierung auf dem Host einrichten (NTP), danach klappt die Anmeldung sofort."
      );
    }

    return GENERIC;
  } catch (error) {
    console.error("[diagnoseTwoFactorFailure]", error);
    return GENERIC;
  }
}

/**
 * Drop the challenge cookie once the second factor has been accepted.
 *
 * The proof has been spent. Leaving it in place keeps a five-minute window in
 * which that one cookie plus any single valid code mints another session.
 */
export async function clearLoginChallenge(): Promise<void> {
  (await cookies()).delete(CHALLENGE_COOKIE);
}

/**
 * Complete the forced password setup for a temp-password account. Runs for the
 * signed-in user only, and only while their `mustSetPassword` flag is still set
 * (so it can't be abused to reset a normal account's password). On success the
 * flag is cleared and a real bcrypt hash is stored; the client then refreshes
 * its JWT and the middleware gate lifts.
 */
export async function completePasswordSetupAction(password: string): Promise<ActionState> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { success: false, error: "Nicht angemeldet." };
  }

  const value = String(password);
  if (value.length < 8) {
    return { success: false, error: "Das Passwort muss mindestens 8 Zeichen haben." };
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, mustSetPassword: true },
  });
  if (!user) {
    return { success: false, error: "Benutzer nicht gefunden." };
  }
  if (!user.mustSetPassword) {
    // Nothing to do — already has a real password. Treat as success so the
    // client simply proceeds into the app.
    return { success: true };
  }

  try {
    const passwordHash = await bcrypt.hash(value, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustSetPassword: false },
    });
  } catch (error) {
    console.error("[completePasswordSetupAction]", error);
    return { success: false, error: "Das Passwort konnte nicht gespeichert werden." };
  }

  return { success: true };
}
