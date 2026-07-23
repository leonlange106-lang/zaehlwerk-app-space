"use server";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@zaehlwerk/database";
import { CHALLENGE_COOKIE } from "./auth-constants";
import { signChallenge } from "./crypto";
import { getSessionUser } from "./auth-helpers";
import type { ActionState } from "./action-state";

const BCRYPT_ROUNDS = 12;

export type LoginPrecheck = {
  ok: boolean;
  twoFactorRequired?: boolean;
  /** Temp-password account: log in without a password, then set one. */
  mustSetPassword?: boolean;
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
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false };

  // Temp-password account → passwordless first login (no bcrypt check).
  if (user.mustSetPassword) {
    return { ok: true, mustSetPassword: true };
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) return { ok: false };

  if (user.twoFactorEnabled) {
    const token = signChallenge({ sub: user.id }, 300);
    (await cookies()).set(CHALLENGE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 300,
      path: "/",
    });
    return { ok: true, twoFactorRequired: true };
  }

  return { ok: true, twoFactorRequired: false };
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
