import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@zaehlwerk/database";
import { APPS } from "./apps";
import { getSessionUser, type SessionUser } from "./auth-helpers";

// Per-user app access. Apps are only visible/usable when assigned to a user;
// new users have NONE by default (schema default "[]"). Admins are a deliberate
// exception — they always see every registered app so they can never lock
// themselves out of the assignment UI.

export const ALL_APP_IDS = APPS.map((app) => app.id);

/**
 * Apps, die an der ROLLE haengen statt an einer Freigabe.
 *
 * Der Admin-Bereich zeigt den Zustand der Plattform. Ihn ueber `allowedApps` zu
 * verteilen hiesse, dass ein Admin ihn erst zugewiesen bekommen muss — und dass
 * man ihn versehentlich einem Nicht-Admin zuweisen KANN. Beides falsch herum.
 */
const ADMIN_ONLY_APP_IDS = APPS.filter((app) => app.adminOnly).map((app) => app.id);

/** Freigaben, die ueberhaupt vergeben werden koennen — ohne die rollengebundenen. */
export const ASSIGNABLE_APP_IDS = ALL_APP_IDS.filter(
  (id) => !ADMIN_ONLY_APP_IDS.includes(id),
);

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

// Per-request memo: a page renders several Server Components and actions that
// each need the assignment, and without this every one of them re-reads the row.
const cachedAllowedAppIds = cache(async (userId: string): Promise<string[]> => {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { allowedApps: true },
  });
  return parseAllowedApps(row?.allowedApps);
});

/** App ids a given user may see/use. Admins get all; others only what's assigned. */
export async function allowedAppIdsFor(
  user: Pick<SessionUser, "id" | "role"> | null | undefined,
): Promise<string[]> {
  if (!user) return [];
  if (user.role === "ADMIN") return [...ALL_APP_IDS];
  // Eine gespeicherte Zuweisung darf eine rollengebundene App nicht oeffnen —
  // sonst waere eine alte oder manipulierte allowedApps-Zeile ein Weg in den
  // Admin-Bereich.
  const assigned = await cachedAllowedAppIds(user.id);
  return assigned.filter((id) => !ADMIN_ONLY_APP_IDS.includes(id as (typeof ALL_APP_IDS)[number]));
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

/**
 * Authorization guard for Server Actions — throws instead of redirecting.
 *
 * `requireAppAccess()` above is NOT sufficient for actions: a `"use server"`
 * export is a directly addressable endpoint, it can be POSTed to any route, and
 * Next runs the action BEFORE rendering the layout that would have redirected.
 * So every action touching an app's data has to authorize itself, exactly like
 * `requireAdmin()` does for the admin-only ones.
 */
export async function assertAppAccess(appId: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Nicht autorisiert.");
  const allowed = await allowedAppIdsFor(user);
  if (!allowed.includes(appId)) throw new Error("Nicht autorisiert.");
  return user;
}
