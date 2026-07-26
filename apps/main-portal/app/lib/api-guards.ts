import { NextResponse } from "next/server";
import { allowedAppIdsFor } from "./app-access";
import { getSessionUser, type SessionUser } from "./auth-helpers";
import { resolveTwoFactorGate } from "./two-factor-policy";

// Authorization for route handlers.
//
// `proxy.ts` authenticates (no session → 401) but deliberately does not
// authorize — see the note in CLAUDE.md. Role and app-access checks therefore
// belong in the route itself, and without them any signed-in user reaches every
// route the guard let through, including ones for apps they were never granted.
//
// Both helpers return the Response to send on denial and `null` when the caller
// is cleared, so a route reads:
//
//   const denied = await denyUnlessAppAccess("log-analyzer");
//   if (denied) return denied;

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Null when the caller satisfies the instance's 2FA policy, else a 403.
 *
 * The page gate lives in the root layout, which route handlers do not go
 * through — so without this an account that is blocked in the browser could
 * still drive the whole API with its session cookie, which is most of what the
 * app can do. Folded into both guards below rather than left for each route to
 * remember, following the same reasoning as the role checks themselves.
 */
async function denyUnlessTwoFactorSatisfied(user: SessionUser): Promise<NextResponse | null> {
  const gate = await resolveTwoFactorGate(user);
  if (!gate.blocked) return null;
  return forbidden(
    "Diese Instanz verlangt Zwei-Faktor-Authentifizierung. Bitte zuerst einrichten.",
  );
}

/** Null when the session may use `appId`, else a 401/403 to return. */
export async function denyUnlessAppAccess(appId: string): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = await denyUnlessTwoFactorSatisfied(user);
  if (blocked) return blocked;
  const allowed = await allowedAppIdsFor(user);
  if (!allowed.includes(appId)) return forbidden("Kein Zugriff auf diese App.");
  return null;
}

/** Null when the session is an ADMIN, else a 401/403 to return. */
export async function denyUnlessAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = await denyUnlessTwoFactorSatisfied(user);
  if (blocked) return blocked;
  if (user.role !== "ADMIN") return forbidden("Diese Aktion ist Administratoren vorbehalten.");
  return null;
}

/** The signed-in user, or null — for routes that only need it for an audit entry. */
export async function sessionUserForAudit(): Promise<SessionUser | null> {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}
