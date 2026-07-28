import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@zaehlwerk/database";
import { authConfig } from "./auth.config";
import { CHALLENGE_COOKIE } from "./app/lib/auth-constants";
import { decryptSecret, verifyChallenge } from "./app/lib/crypto";
import { verifyTotp } from "./app/lib/totp";
import { AUDIT_ACTIONS, recordAuditEvent } from "./app/lib/audit";
import {
  callerIdentity,
  checkLoginAttempt,
  checkTotpAttempt,
  noteLoginSuccess,
  noteTotpSuccess,
} from "./app/lib/login-throttle";

// Full (Node-runtime) Auth.js config. Uses the shared edge-safe base and adds
// the Credentials provider, whose authorize() reaches Prisma + bcrypt — which
// is why it can't live in auth.config.ts (imported by the edge middleware).
// Only the route handler and server code import this file.

function readCookie(request: Request | undefined, name: string): string | null {
  const header = request?.headers?.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
        code: { label: "2FA-Code", type: "text" },
        mode: { type: "text" },
      },
      async authorize(credentials, request) {
        const mode = String(credentials?.mode ?? "password");

        // Second factor: the challenge cookie proves the password step already
        // passed (set by beginLoginAction), so here we only verify the TOTP code.
        if (mode === "totp") {
          const challenge = readCookie(request, CHALLENGE_COOKIE);
          if (!challenge) return null;
          const payload = verifyChallenge<{ sub?: string }>(challenge);
          if (!payload?.sub) return null;

          const user = await prisma.user.findUnique({ where: { id: payload.sub } });
          if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return null;

          // Bremse VOR der Pruefung. Ein TOTP-Code hat eine Million
          // Moeglichkeiten, und das Suchfenster akzeptiert 41 davon gleichzeitig
          // — ohne Grenze ist das in Reichweite eines Skripts, das das Passwort
          // bereits hat. Die Begruendung liefert diagnoseTwoFactorFailure nach;
          // authorize() kann nur Benutzer oder null zurueckgeben.
          const caller = callerIdentity(request?.headers ?? new Headers());
          if (!checkTotpAttempt(caller, user.id).allowed) {
            void recordAuditEvent(AUDIT_ACTIONS.loginBlocked, user.email, `2FA, IP ${caller}`);
            return null;
          }

          let secret: string;
          try {
            secret = decryptSecret(user.twoFactorSecret);
          } catch {
            return null;
          }
          if (!verifyTotp(secret, String(credentials?.code ?? ""))) {
            void recordAuditEvent(AUDIT_ACTIONS.loginFailed, user.email, `2FA, IP ${caller}`);
            return null;
          }

          noteTotpSuccess(user.id);

          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            role: user.role,
            mustSetPassword: user.mustSetPassword,
          };
        }

        // First login of a temp-password account: no password is verified — the
        // account was created with a random temp hash and mustSetPassword=true.
        // A session is issued, but the middleware then forces /set-password
        // before any app is usable. Passwordless auth is ONLY valid while the
        // flag is set; once a real password exists this path returns null.
        if (mode === "firstlogin") {
          const email = String(credentials?.email ?? "").trim().toLowerCase();
          if (!email) return null;
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user || !user.mustSetPassword) return null;
          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            role: user.role,
            mustSetPassword: true,
          };
        }

        // First factor: email + password.
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Bremse auch HIER, nicht nur in beginLoginAction.
        //
        // Die Oberflaeche fragt erst dort an und kommt nur bei richtigem Passwort
        // hierher — ein Skript aber muss diesen Weg nicht gehen. Es kann direkt
        // gegen `POST /api/auth/callback/credentials` schiessen und laesst die
        // vorgelagerte Pruefung dabei einfach aus. Waere die Bremse nur dort,
        // stuende die Tuer, die sie schliessen soll, daneben weiter offen.
        //
        // Doppelt zaehlt das im Normalfall nicht: Der geglueckte Versuch in
        // beginLoginAction hat den Kontozaehler schon geleert, und ein
        // gescheiterter kommt hier gar nicht erst an.
        const caller = callerIdentity(request?.headers ?? new Headers());
        if (!checkLoginAttempt(caller, email).allowed) {
          void recordAuditEvent(AUDIT_ACTIONS.loginBlocked, email, `IP ${caller}`);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        if (!(await bcrypt.compare(password, user.passwordHash))) return null;

        noteLoginSuccess(email);

        // If 2FA is enabled, the password alone must NOT create a session — the
        // client is expected to complete the second factor at /login/2fa.
        if (user.twoFactorEnabled) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          mustSetPassword: user.mustSetPassword,
        };
      },
    }),
  ],
});
