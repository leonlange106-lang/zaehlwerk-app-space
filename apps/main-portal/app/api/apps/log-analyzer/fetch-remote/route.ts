import { type NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, unauthorizedResponse } from "@/app/lib/api-auth";
import { allowedAppIdsFor } from "@/app/lib/app-access";
import { clientIdentifier, rateLimit } from "@/app/lib/rate-limit";
import { parseLog } from "@/app/apps/log-analyzer/lib/log-parser";
import { parseShareLink } from "@/app/apps/log-analyzer/lib/mgflasher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = "log-analyzer";

// Remote fetches hit an external service and parse potentially large payloads,
// so keep the per-IP budget tighter than the telemetry ingest endpoint.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

// Abort a slow/hanging upstream so a request can't pin a worker indefinitely.
const FETCH_TIMEOUT_MS = 12_000;

// Refuse absurdly large exports — a datalog CSV is at most a few MB.
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Server-side importer for MGflasher share links.
 *
 * Flow: authenticate → authorize (must have the `log-analyzer` app) → validate
 * the share URL (this is also the SSRF guard: only `logs.mgflasher.com` is ever
 * contacted) → fetch the CSV export with a timeout → parse it → return the
 * structured log. Every failure mode maps to a precise status + German message
 * the UI can surface directly.
 *
 * Body: `{ "url": "https://logs.mgflasher.com/log/<uuid>" }`.
 */
export async function POST(request: NextRequest) {
  const limit = rateLimit({
    key: `log-analyzer:fetch:${clientIdentifier(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte später erneut versuchen." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const user = await authenticateApiRequest(request);
  if (!user) return unauthorizedResponse();

  const allowed = await allowedAppIdsFor(user);
  if (!allowed.includes(APP_ID)) {
    return NextResponse.json(
      { error: "Kein Zugriff auf den Log Analyzer." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url : "";
  const link = parseShareLink(url, process.env.MGFLASHER_LOG_BASE);
  if (!link.ok) {
    return NextResponse.json({ error: link.reason }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(link.csvUrl, {
      signal: controller.signal,
      redirect: "error", // never follow a redirect off the allowed host
      headers: { Accept: "text/csv, text/plain" },
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Zeitüberschreitung beim Abruf des Logs." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Der MGflasher-Server ist nicht erreichbar." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    return NextResponse.json(
      { error: "Kein Log unter diesem Link gefunden." },
      { status: 404 },
    );
  }
  if (response.status === 429) {
    return NextResponse.json(
      { error: "MGflasher hat die Anfrage limitiert (Rate-Limit). Bitte später erneut." },
      { status: 429 },
    );
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: `Abruf fehlgeschlagen (HTTP ${response.status}).` },
      { status: 502 },
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    return NextResponse.json({ error: "Das Log ist zu groß." }, { status: 413 });
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Das Log ist zu groß." }, { status: 413 });
  }
  if (text.trim() === "") {
    return NextResponse.json(
      { error: "Der Link enthält keine Log-Daten." },
      { status: 422 },
    );
  }

  let log;
  try {
    log = parseLog(text);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Log konnte nicht verarbeitet werden." },
      { status: 422 },
    );
  }
  if (log.rowCount === 0) {
    return NextResponse.json(
      { error: "Das Log enthält keine auswertbaren Datenzeilen." },
      { status: 422 },
    );
  }

  // Return the raw CSV too so the client can persist it server-side.
  return NextResponse.json({ ok: true, source: link.canonicalUrl, csv: text, log });
}
