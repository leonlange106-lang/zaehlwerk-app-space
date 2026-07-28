import { type NextRequest, NextResponse } from "next/server";
import {
  apiMeterCreateSchema,
  DEFAULT_OBIS_CODE,
  NOT_DELETED,
  Prisma,
  prisma,
} from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";
import { clientIdentifier, rateLimit } from "../../../lib/rate-limit";
import {
  fieldErrorsFromZod,
  rateLimitedProblem,
  validationProblem,
} from "../../../lib/api-problem";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../lib/audit";

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
  if (!limit.ok) return rateLimitedProblem(limit.retryAfter);

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
        where: NOT_DELETED,
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
            where: NOT_DELETED,
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

/**
 * Einen Zähler anlegen.
 *
 * Zusammen mit seinem Standardregister, in EINER Transaktion. Ein Zähler ohne
 * Register wäre kein halbfertiger Datensatz, sondern ein stiller: Der erste
 * gemeldete Stand legte sich sein Register selbst an — aber erst dann, und bis
 * dahin sähe ein Client einen Zähler ohne jede Reihe und wüsste nicht, ob das
 * Absicht ist.
 */
export async function POST(request: NextRequest) {
  const limit = rateLimit({
    key: `meter-write:${clientIdentifier(request)}`,
    limit: 60,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) return rateLimitedProblem(limit.retryAfter);

  const user = await authenticateApiRequest(request);
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationProblem(
      [{ field: "(body)", message: "Der Body ist kein gültiges JSON." }],
      "Der Body ist kein gültiges JSON.",
    );
  }

  const parsed = apiMeterCreateSchema.safeParse(body);
  if (!parsed.success) return validationProblem(fieldErrorsFromZod(parsed.error));

  const input = parsed.data;

  let created;
  try {
    created = await prisma.zaehler.create({
      data: {
        name: input.name,
        kategorie: input.category,
        einheit: input.unit,
        locationId: input.locationId ?? null,
        ...(input.color ? { farbe: input.color } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.digits === undefined ? {} : { stellen: input.digits }),
        ...(input.readingIntervalDays === undefined
          ? {}
          : { ableseIntervallTage: input.readingIntervalDays }),
        // Das Standardregister gleich mit — siehe oben.
        register: {
          create: {
            obisCode: DEFAULT_OBIS_CODE,
            richtung: "BEZUG",
            einheit: input.unit,
            label: "Bezug",
            sortIndex: 0,
          },
        },
      },
      select: {
        id: true,
        name: true,
        kategorie: true,
        einheit: true,
        farbe: true,
        icon: true,
        aktiv: true,
        locationId: true,
        stellen: true,
        ableseIntervallTage: true,
        register: { select: { id: true, obisCode: true, richtung: true, label: true } },
      },
    });
  } catch (error) {
    // Ein Standort, den es nicht gibt. Als Feldfehler, nicht als 500 — der
    // Aufrufer hat einen Wert geschickt, nicht der Server einen Fehler gemacht.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return validationProblem(
        [{ field: "locationId", message: "Dieser Standort existiert nicht." }],
        "Dieser Standort existiert nicht.",
      );
    }
    throw error;
  }

  void recordAuditEvent(
    AUDIT_ACTIONS.apiMeterCreate,
    `${user.email} (${user.via})`,
    `Zähler ${created.id} (${created.name}, ${created.kategorie})`,
  ).catch(() => {});

  return NextResponse.json(
    {
      meter: {
        id: created.id,
        name: created.name,
        category: created.kategorie,
        unit: created.einheit,
        color: created.farbe,
        icon: created.icon,
        active: created.aktiv,
        locationId: created.locationId,
        digits: created.stellen,
        readingIntervalDays: created.ableseIntervallTage,
        registers: created.register.map((entry) => ({
          id: entry.id,
          obisCode: entry.obisCode,
          direction: entry.richtung,
          label: entry.label,
        })),
      },
    },
    { status: 201 },
  );
}
