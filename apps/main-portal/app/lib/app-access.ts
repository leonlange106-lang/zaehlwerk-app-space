import { redirect } from "next/navigation";
import { prisma } from "@zaehlwerk/database";
import { APPS } from "./apps";
import { getSessionUser, type SessionUser } from "./auth-helpers";

// Per-user app access. Apps are only visible/usable when assigned to a user;
// new users have NONE by default (schema default "[]"). Admins are a deliberate
// exception — they always see every registered app so they can never lock
// themselves out of the assignment UI.

export const ALL_APP_IDS = APPS.map((app) => app.id);

export function parseAllowedApps(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && ALL_APP_IDS.includes(id as (typeof ALL_APP_IDS)[number]));
  } catch {
    return [];
  }
}

/** Normalise + dedupe an assignment before persisting (drops unknown ids). */
export function serializeAllowedApps(ids: string[]): string {
  const clean = [...new Set(ids)].filter((id) => ALL_APP_IDS.includes(id as (typeof ALL_APP_IDS)[number]));
  return JSON.stringify(clean);
}

/** App ids a given user may see/use. Admins get all; others only what's assigned. */
export async function allowedAppIdsFor(
  user: Pick<SessionUser, "id" | "role"> | null | undefined,
): Promise<string[]> {
  if (!user) return [];
  if (user.role === "ADMIN") return [...ALL_APP_IDS];
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { allowedApps: true },
  });
  return parseAllowedApps(row?.allowedApps);
}

/** App ids the current session may see/use. */
export async function getAllowedAppIds(): Promise<string[]> {
  return allowedAppIdsFor(await getSessionUser());
}

/**
 * Route guard for an app subtree: if the current user isn't allowed the app,
 * bounce them back to the launcher. Call from the app's layout.
 */
export async function requireAppAccess(appId: string): Promise<void> {
  const allowed = await getAllowedAppIds();
  if (!allowed.includes(appId)) redirect("/");
}
