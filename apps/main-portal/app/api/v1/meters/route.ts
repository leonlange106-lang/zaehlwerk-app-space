import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";
import { clientIdentifier, rateLimit } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Die LESEseite der Smart-Home-API.
//
// `POST /api/v1/readings` gibt es seit langem — man konnte einen Zählerstand
// also melden, aber nirgends erfahren, welche Zähler es gibt oder wie sie gerade
// stehen. Für eine Home-Assistant-Integration ist genau das die Voraussetzung:
// eine Entität braucht einen Zustand, und den muss sie abfragen können.
//
// Bewusst EIN Aufruf für alles, was eine Integration beim Abfragen braucht —
// Zähler, aktueller Stand, Zeitpunkt. Ein Aufruf je Zähler wäre bei einem
// 30-Sekunden-Intervall und zehn Zählern ein unnötiges Vielfaches an Anfragen
// für Daten, die ohnehin zusammen gelesen werden.

// Großzügiger als beim Schreiben: Abfragen sind billig und ein
// Polling-Intervall von 30 s über mehrere Integrationen summiert sich schnell.
const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 60_000;

/** Wie viele Ablesungen je Zähler höchstens mitkommen, wenn Historie angefragt ist. */
const MAX_HISTORY = 100;

export async function GET(request: NextRequest) {
  const limit = rateLimit({
    key: `meters:${clientIdentifier(request)}`,
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

  const url = new URL(request.url);
  // Historie ist opt-in: sie vervielfacht die Antwort, und eine Integration, die
  // nur den aktuellen Stand zeigt, soll sie nicht bezahlen.
  const historyParam = Number.parseInt(url.searchParams.get("history") ?? "0", 10);
  const history = Number.isFinite(historyParam)
    ? Math.min(Math.max(historyParam, 0), MAX_HISTORY)
    : 0;

  const rows = await prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: [{ sortIndex: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kategorie: true,
      einheit: true,
      farbe: true,
      ableseIntervallTage: true,
      location: { select: { name: true } },
      // Immer die neueste Ablesung; bei `history=N` die N neuesten.
      ablesungen: {
        orderBy: { datum: "desc" },
        take: Math.max(1, history),
        select: { id: true, datum: true, wert: true, quelle: true },
      },
      register: {
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          obisCode: true,
          richtung: true,
          label: true,
          einheit: true,
          ablesungen: {
            orderBy: { datum: "desc" },
            take: Math.max(1, history),
            select: { datum: true, wert: true, quelle: true },
          },
        },
      },
    },
  });

  const meters = rows.map((row) => {
    // `current` bleibt der BEZUG — nicht einfach die neueste Ablesung des
    // Zählers. Mit einem zweiten Register wäre das sonst mal der Bezug und mal
    // die Einspeisung, je nachdem, welcher Wert zuletzt eintraf: Dasselbe Feld
    // hätte von Tag zu Tag eine andere Bedeutung, ohne dass ein Aufrufer es
    // merkt. Erst wenn es gar keine Register gibt (Zähler, auf den seit der
    // Migration nichts geschrieben wurde), gilt die neueste Ablesung.
    const bezug = row.register.find((reg) => reg.richtung === "BEZUG") ?? null;
    const latest = bezug ? (bezug.ablesungen[0] ?? null) : (row.ablesungen[0] ?? null);
    return {
      id: row.id,
      name: row.name,
      category: row.kategorie,
      unit: row.einheit,
      color: row.farbe,
      location: row.location?.name ?? null,
      /** 0 = keine Erinnerung konfiguriert. */
      readingIntervalDays: row.ableseIntervallTage,
      current: latest
        ? { value: latest.wert, at: latest.datum.toISOString(), source: latest.quelle }
        : null,
      // Die Register einzeln — nie saldiert. Bezug und Einspeisung sind zwei
      // eigenständige Reihen; eine Differenz daraus zu bilden wäre eine
      // Interpretation, die der Aufrufer selbst treffen soll. Für das
      // HA-Energie-Dashboard sind es ohnehin getrennte Sensoren.
      registers: row.register.map((reg) => {
        const regLatest = reg.ablesungen[0] ?? null;
        return {
          obisCode: reg.obisCode,
          direction: reg.richtung,
          label: reg.label,
          unit: reg.einheit,
          current: regLatest
            ? {
                value: regLatest.wert,
                at: regLatest.datum.toISOString(),
                source: regLatest.quelle,
              }
            : null,
          ...(history > 0
            ? {
                history: reg.ablesungen.map((entry) => ({
                  value: entry.wert,
                  at: entry.datum.toISOString(),
                  source: entry.quelle,
                })),
              }
            : {}),
        };
      }),
      // Nur wenn angefragt — sonst bliebe das Feld eine leere Liste, die wie
      // "keine Ablesungen" aussieht statt wie "nicht abgefragt".
      ...(history > 0
        ? {
            history: (bezug ? bezug.ablesungen : row.ablesungen).map((entry) => ({
              value: entry.wert,
              at: entry.datum.toISOString(),
              source: entry.quelle,
            })),
          }
        : {}),
    };
  });

  return NextResponse.json(
    { meters },
    // Kein Zwischenspeicher: eine Integration fragt, weil sie den aktuellen
    // Stand will, und eine gecachte Antwort wäre genau das nicht.
    { headers: { "Cache-Control": "no-store" } },
  );
}
