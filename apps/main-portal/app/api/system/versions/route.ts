import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/app/lib/api-guards";
import { resolveVersionList } from "@/app/lib/version-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The versions this instance can switch to, newest first.
 *
 * Admin-only: it discloses the deploy history (when each build landed) and the
 * channel the instance follows, neither of which is any signed-in user's
 * business. `proxy.ts` authenticates but does not authorize — see CLAUDE.md.
 */
export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const result = await resolveVersionList();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
