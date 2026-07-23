import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { collectMetrics } from "@/app/lib/system-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only snapshot of host/container metrics. Polled by the admin panel to
// drive the live graphs.
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Nur für Administratoren." }, { status: 403 });
  }
  const metrics = await collectMetrics();
  return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } });
}
