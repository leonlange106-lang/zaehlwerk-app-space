import { NextResponse } from "next/server";
import { readUpdateState } from "@/app/lib/update-state";
import { denyUnlessAdmin } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Point-in-time snapshot of the global update state. The client fetches this on
// settings mount/refresh; if it reports RUNNING it attaches to the SSE stream.
export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const state = await readUpdateState();
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
