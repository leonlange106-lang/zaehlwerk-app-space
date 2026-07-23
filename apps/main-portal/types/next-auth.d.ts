import type { DefaultSession } from "next-auth";
import type { UserRole } from "@zaehlwerk/database/shared";

// Augment Auth.js types so `session.user.role` / `.id` and the JWT carry our
// role, end to end (authorize → jwt callback → session callback → components).
declare module "next-auth" {
  interface User {
    role?: UserRole;
  }
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
