import { type NextRequest, NextResponse } from "next/server";
import { createLogs, listLogs, type LogUploadInput } from "@/app/lib/log-repository";
import { recordAuditEvent } from "@/app/lib/audit";
import { denyUnlessAppAccess, sessionUserForAudit } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-persisted datalogs. GET lists summaries; POST accepts one or many logs
// (bulk upload) as { files: [{ name, csv, source?, sourceUrl? }] }.

export async function GET(request: NextRequest) {
  const denied = await denyUnlessAppAccess(APP_ID);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const toInt = (value: string | null): number | undefined => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const page = await listLogs({
    limit: toInt(params.get("limit")),
    offset: toInt(params.get("offset")),
  });

  // `logs` bleibt an seinem Platz — die Oberflaeche liest genau dieses Feld.
  // Die Seitenangaben kommen daneben, damit ein Aufrufer weiss, was er NICHT
  // sieht: Eine abgeschnittene Liste ohne diese Angabe sieht aus wie der ganze
  // Bestand.
  return NextResponse.json(
    { logs: page.logs, total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Stored datalogs carry VINs and vehicle data — readable only by users who were
// actually granted the Log Analyzer, not by everyone with a session.
const APP_ID = "log-analyzer";

const MAX_FILES = 50;
const MAX_CSV_BYTES = 8_000_000; // 8 MB per file — generous for a long datalog

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAppAccess(APP_ID);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }

  const raw = (body as { files?: unknown })?.files;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "Keine Dateien übermittelt." }, { status: 400 });
  }
  if (raw.length > MAX_FILES) {
    return NextResponse.json({ error: `Maximal ${MAX_FILES} Dateien pro Upload.` }, { status: 400 });
  }

  const inputs: LogUploadInput[] = [];
  for (const entry of raw) {
    const f = entry as Record<string, unknown>;
    const name = typeof f.name === "string" ? f.name : "";
    const csv = typeof f.csv === "string" ? f.csv : "";
    if (!name || !csv) {
      return NextResponse.json({ error: "Jede Datei braucht name und csv." }, { status: 400 });
    }
    if (csv.length > MAX_CSV_BYTES) {
      return NextResponse.json({ error: `Datei "${name}" ist zu groß.` }, { status: 413 });
    }
    inputs.push({
      name,
      csv,
      source: f.source === "remote" ? "remote" : "upload",
      sourceUrl: typeof f.sourceUrl === "string" ? f.sourceUrl : null,
    });
  }

  const logs = await createLogs(inputs);

  try {
    const user = await sessionUserForAudit();
    await recordAuditEvent(
      "loganalyzer.upload",
      user?.email ?? "system",
      `${logs.length} Log(s) hochgeladen`,
    );
  } catch {
    // audit is best-effort — never block the upload
  }

  return NextResponse.json({ logs }, { status: 201 });
}
