import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { listNotifications, markAllRead } from "@/app/lib/notification-source";
import { allowedAppIdsFor } from "@/app/lib/app-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bell's data. GET lists what is currently true; POST marks it read.
//
// Read markers are per user, so both verbs key off the session and never take a
// user id from the request. Every condition reported here is platform state an
// operator is entitled to see, so this is session-gated rather than admin-only —
// but the ACTIONS behind them (installing an update, running a backup) keep
// their own admin checks, which is where that authority actually lives.

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await listNotifications(user.id, { allowedAppIds: await allowedAppIdsFor(user) });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await markAllRead(user.id, { allowedAppIds: await allowedAppIdsFor(user) });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
