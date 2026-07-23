import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import type { UserRole } from "@zaehlwerk/database/shared";
import { auth } from "@/auth";
import { hashToken } from "./crypto";

export type ApiUser = {
  id: string;
  email: string;
  role: UserRole;
  via: "session" | "token";
};

/**
 * Authenticate an API request by EITHER a web session (cookie) OR a Personal
 * Access Token (`Authorization: Bearer zw_pat_…`). Lets external scripts / Smart
 * Home devices reach protected endpoints without a browser session. Returns the
 * user, or null if neither is valid.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiUser | null> {
  const session = await auth();
  if (session?.user) {
    return {
      id: session.user.id,
      email: session.user.email ?? "",
      role: session.user.role,
      via: "session",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token.startsWith("zw_pat_")) return null;

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, role: true } } },
  });
  if (!record) return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  // Best-effort "last used" stamp — never block the request on it.
  void prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: record.user.id, email: record.user.email, role: record.user.role, via: "token" };
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
