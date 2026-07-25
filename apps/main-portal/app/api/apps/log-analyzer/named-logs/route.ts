import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import { denyUnlessAppAccess } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Named logs, for the navigation menu's Log-Übersicht submenu.
//
// Only logs the user actually named (`label`) appear. That filter is the whole
// point: the log corpus grows without bound — the watch-folder and the ingestion
// API add rows unattended — and a menu listing every imported filename would stop
// being a menu. Naming a log in the overview is the deliberate act that promotes
// it to navigation.
//
// Fetched on demand by the menu, and the CSV column is never selected: it is by
// far the largest column in the database.

const MAX = 20;

export interface MenuLog {
  id: string;
  label: string;
  status: string;
  health: string;
  recordedAt: string | null;
}

export async function GET() {
  const denied = await denyUnlessAppAccess("log-analyzer");
  if (denied) return denied;

  const rows = await prisma.logFile.findMany({
    // Prisma has no "non-empty string" filter, but `updateLogTags` normalises a
    // cleared field to NULL, so "has a label" is exactly "label is not null".
    where: { label: { not: null } },
    orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: MAX,
    select: { id: true, label: true, status: true, health: true, recordedAt: true },
  });

  const logs: MenuLog[] = rows.map((row) => ({
    id: row.id,
    label: row.label!,
    status: row.status,
    health: row.health,
    recordedAt: row.recordedAt ? row.recordedAt.toISOString() : null,
  }));

  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}
