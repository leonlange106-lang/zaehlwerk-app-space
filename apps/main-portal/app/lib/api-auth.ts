import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import type { UserRole } from "@zaehlwerk/database/shared";
import { auth } from "@/auth";
import { hashToken } from "./crypto";
import { unauthorizedProblem } from "./api-problem";

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

/**
 * Die 401-Antwort aller API-Routen.
 *
 * Eine Stelle, damit die Umstellung aufs Problem-Format nicht an zwölf Orten
 * einzeln nachgezogen werden muss — und damit sie an keinem davon vergessen
 * wird. `error` bleibt enthalten, siehe `api-problem.ts`.
 *
 * Der Text sagt jetzt auch, WIE man sich ausweist. „Unauthorized" allein half
 * niemandem, der sein Token im falschen Kopf mitschickte.
 */
export function unauthorizedResponse(): NextResponse {
  return unauthorizedProblem();
}
