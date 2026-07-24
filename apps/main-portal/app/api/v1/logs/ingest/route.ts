import { type NextRequest, NextResponse } from "next/server";
import { authenticateIngestion, ingestionUnauthorized } from "@/app/lib/ingestion-auth";
import { ingestCsv } from "@/app/lib/log-ingest";
import { AUDIT_ACTIONS, recordAuditEvent } from "@/app/lib/audit";
import { clientIdentifier, rateLimit } from "@/app/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Automated log-ingestion endpoint for Home Assistant, cURL and sync scripts.
//
//   POST /api/v1/logs/ingest
//   Auth:  X-API-Key: <key>   (or  Authorization: Bearer <key>)
//   Body:  multipart/form-data with a `file` field  OR  raw text/csv
//   Params (query or form): profileId, notes, vehicle, name
//   → { success: true, logId, status: "VERIFIED"|"WARNING"|"UNVERIFIED", duplicate }
//
// Deduplicated by CSV content hash (a file pushed twice imports once) and
// broadcast over SSE so open dashboards refresh immediately.

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_CSV_BYTES = 8_000_000; // 8 MB — generous for a long datalog

/** Read an optional string from form data or the query string (form wins). */
function pick(form: FormData | null, params: URLSearchParams, key: string): string | null {
  const fromForm = form?.get(key);
  if (typeof fromForm === "string" && fromForm.trim()) return fromForm.trim();
  const fromQuery = params.get(key);
  return fromQuery && fromQuery.trim() ? fromQuery.trim() : null;
}

export async function POST(request: NextRequest) {
  const limit = rateLimit({
    key: `logs-ingest:${clientIdentifier(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { success: false, error: "Zu viele Anfragen. Bitte später erneut versuchen." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const principal = await authenticateIngestion(request);
  if (!principal) return ingestionUnauthorized();

  const params = request.nextUrl.searchParams;
  const contentType = request.headers.get("content-type") ?? "";

  let csv: string;
  let name: string | null;
  let form: FormData | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      form = await request.formData();
      const file = form.get("file") ?? form.get("log") ?? form.get("csv");
      if (file instanceof Blob) {
        csv = await file.text();
        // A File carries its own name; fall back to explicit fields / query.
        name = (file as File).name || pick(form, params, "name");
      } else if (typeof file === "string") {
        csv = file;
        name = pick(form, params, "name");
      } else {
        return NextResponse.json(
          { success: false, error: "Kein `file`-Feld im Formular gefunden." },
          { status: 400 },
        );
      }
    } else {
      // Raw text/csv (or text/plain / octet-stream) body.
      csv = await request.text();
      name = pick(null, params, "name") ?? request.headers.get("x-filename");
    }
  } catch {
    return NextResponse.json({ success: false, error: "Body konnte nicht gelesen werden." }, { status: 400 });
  }

  if (!csv || !csv.trim()) {
    return NextResponse.json({ success: false, error: "Leerer CSV-Inhalt." }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ success: false, error: "Datei ist zu groß." }, { status: 413 });
  }

  const finalName = name?.trim() || `ingest-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

  let result;
  try {
    result = await ingestCsv({
      name: finalName,
      csv,
      source: "ingest",
      vehicle: pick(form, params, "vehicle"),
      notes: pick(form, params, "notes"),
      profileId: pick(form, params, "profileId"),
    });
  } catch (error) {
    console.error("[logs/ingest]", error);
    return NextResponse.json({ success: false, error: "Verarbeitung fehlgeschlagen." }, { status: 500 });
  }

  // Audit is best-effort — never block the ingest.
  void recordAuditEvent(
    AUDIT_ACTIONS.logIngest,
    `${principal.via}:${principal.name}`,
    `${finalName} → ${result.ingestStatus}${result.duplicate ? " (Duplikat)" : ""}`,
  ).catch(() => {});

  return NextResponse.json(
    {
      success: true,
      logId: result.log.id,
      status: result.ingestStatus,
      duplicate: result.duplicate,
      health: result.log.health,
      name: result.log.name,
    },
    { status: result.duplicate ? 200 : 201 },
  );
}
