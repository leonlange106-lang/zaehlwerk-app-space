import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@zaehlwerk/database/shared";

// Edge-safe half of the Auth.js config: NO Prisma, NO bcrypt, so it can be
// imported by the middleware (which runs on the Edge runtime). The Credentials
// provider (which needs Node + Prisma) lives only in auth.ts. These callbacks
// touch only the token/session objects, so they're safe on the edge too and
// let the middleware read the signed-in user's role from the JWT.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.name = user.name ?? null;
        token.email = user.email ?? null;
        token.mustSetPassword = user.mustSetPassword ?? false;
      }
      // After the user sets their own password we refresh the JWT client-side
      // via update({ mustSetPassword: false }) so the middleware gate clears
      // without forcing a re-login. No DB access → edge-safe.
      if (trigger === "update" && session && typeof session.mustSetPassword === "boolean") {
        token.mustSetPassword = session.mustSetPassword;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? "";
        session.user.role = (token.role as UserRole) ?? "USER";
        session.user.mustSetPassword = Boolean(token.mustSetPassword);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
