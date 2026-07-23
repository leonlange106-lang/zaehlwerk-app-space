import { prisma } from "@zaehlwerk/database";
import type { UserRole } from "@zaehlwerk/database/shared";
import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

/** The signed-in user (from the JWT session), or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role,
  };
}

/** Throws unless the caller is a signed-in ADMIN. Use at the top of admin-only
 *  server actions — never trust the client to hide the UI. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Nicht autorisiert.");
  }
  return user;
}

export function userCount(): Promise<number> {
  return prisma.user.count();
}

export function adminCount(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN" } });
}
