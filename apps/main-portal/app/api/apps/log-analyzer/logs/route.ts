import { type NextRequest, NextResponse } from "next/server";
import { createLogs, listLogs, type LogUploadInput } from "@/app/lib/log-repository";
import { recordAuditEvent } from "@/app/lib/audit";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-persisted datalogs. GET lists summaries; POST accepts one or many logs
// (bulk upload) as { files: [{ name, csv, source?, sourceUrl? }] }.

export async function GET() {
  const logs = await listLogs();
  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}

const MAX_FILES = 50;
const MAX_CSV_BYTES = 8_000_000; // 8 MB per file — generous for a long datalog

export async function POST(request: NextRequest) {
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
    const session = await auth();
    await recordAuditEvent(
      "loganalyzer.upload",
      session?.user?.email ?? "system",
      `${logs.length} Log(s) hochgeladen`,
    );
  } catch {
    // audit is best-effort — never block the upload
  }

  return NextResponse.json({ logs }, { status: 201 });
}
