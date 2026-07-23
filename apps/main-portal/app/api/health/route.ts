import { NextResponse } from "next/server";

// Cheap liveness probe for the Docker healthcheck: no DB, no external calls, so
// it stays fast and 200 as long as the Next server itself is up. Pointing the
// healthcheck at the full SSR dashboard (`/`) instead made the container flap
// to "unhealthy" on cold start when that page's server render + DB access
// exceeded the 5s timeout.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
