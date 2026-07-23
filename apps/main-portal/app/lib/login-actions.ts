"use server";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@zaehlwerk/database";
import { CHALLENGE_COOKIE } from "./auth-constants";
import { signChallenge } from "./crypto";

export type LoginPrecheck = {
  ok: boolean;
  twoFactorRequired?: boolean;
};

/**
 * First login step: verify email + password WITHOUT issuing a session. If the
 * user has 2FA on, set a short-lived signed challenge cookie and tell the client
 * to continue at /login/2fa; otherwise the client proceeds straight to signIn().
 * Returns only a boolean either way — never leaks whether the email exists.
 */
export async function beginLoginAction(email: string, password: string): Promise<LoginPrecheck> {
  const normalized = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false };

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
