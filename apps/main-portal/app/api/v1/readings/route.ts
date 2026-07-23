import { type NextRequest, NextResponse } from "next/server";
import {
  apiReadingCreateSchema,
  calculateConsumption,
  prisma,
} from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Synthetische Id für den noch nicht gespeicherten Stand, damit
// calculateConsumption ihn wie eine echte Ablesung behandeln kann.
const PENDING_ID = "__pending__";

/**
 * Smart-Home-/Webhook-Endpunkt zur automatischen Zählerstands-Erfassung
 * (ESPHome, Tasmota, Home Assistant, Node-RED, …).
 *
 * Auth: Personal Access Token per `Authorization: Bearer zw_pat_…` (oder eine
 * gültige Web-Session) — validiert über `authenticateApiRequest`.
 *
 * Body: `{ "meterId": "<uuid>", "value": 1234.56, "timestamp": "…"? }`.
 *
 * Plausibilität: der neue Stand wird zusammen mit den vorhandenen Ablesungen
 * durch die bestehende Verbrauchsberechnung (`consumption.ts`) geschickt.
 * Ergibt das Intervall bis zum neuen Stand einen negativen Verbrauch, gilt er
 * als unplausibel und wird mit 422 abgelehnt — es sei denn, `allowImplausible`
 * ist gesetzt (z. B. bei einem echten Zählertausch).
 */
export async function POST(request: NextRequest) {
  const user = await authenticateApiRequest(request);
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Ungültiger JSON-Body." },
      { status: 400 },
    );
  }

  const parsed = apiReadingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { meterId, value, timestamp, note, zaehlerGetauscht, startwertNeu, allowImplausible } =
    parsed.data;
  const datum = timestamp ?? new Date();

  const zaehler = await prisma.zaehler.findUnique({
    where: { id: meterId },
    select: { id: true, name: true, einheit: true, aktiv: true },
  });
  if (!zaehler) {
    return NextResponse.json({ error: "Zähler nicht gefunden." }, { status: 404 });
  }

  // Plausibilitätsprüfung über die bestehende Verbrauchslogik: den neuen Stand
  // provisorisch in die Historie einfügen und das dazugehörige Intervall prüfen.
  const existing = await prisma.ablesung.findMany({
    where: { zaehlerId: meterId },
    select: { id: true, datum: true, wert: true, zaehlerGetauscht: true, startwertNeu: true },
  });
  const intervals = calculateConsumption([
    ...existing,
    { id: PENDING_ID, datum, wert: value, zaehlerGetauscht, startwertNeu: startwertNeu ?? null },
  ]);
  const newInterval = intervals.find((interval) => interval.toReadingId === PENDING_ID) ?? null;
  const isImplausible = newInterval !== null && newInterval.amount === null;

  if (isImplausible && !allowImplausible) {
    return NextResponse.json(
      {
        error:
          "Unplausibler Zählerstand: Der Verbrauch seit der vorherigen Ablesung wäre negativ. " +
          "Bei einem Zählertausch `zaehlerGetauscht`/`startwertNeu` senden, oder `allowImplausible: true`.",
        plausibility: {
          from: newInterval?.from?.toISOString() ?? null,
          to: newInterval?.to.toISOString() ?? null,
          value,
        },
      },
      { status: 422 },
    );
  }

  const created = await prisma.ablesung.create({
    data: {
      zaehlerId: meterId,
      datum,
      wert: value,
      zaehlerGetauscht,
      startwertNeu: startwertNeu ?? null,
      notiz: note ?? null,
      quelle: "api",
    },
    select: { id: true, datum: true, wert: true, quelle: true },
  });

  return NextResponse.json(
    {
      ok: true,
      reading: {
        id: created.id,
        meterId,
        value: created.wert,
        timestamp: created.datum.toISOString(),
        source: created.quelle,
      },
      consumption: newInterval
        ? {
            amount: newInterval.amount,
            amountPerDay: newInterval.amountPerDay,
            days: newInterval.days,
            unit: zaehler.einheit,
            implausible: isImplausible,
          }
        : null,
    },
    { status: 201 },
  );
}
