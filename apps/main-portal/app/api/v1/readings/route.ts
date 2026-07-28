import { type NextRequest, NextResponse } from "next/server";
import {
  apiReadingCreateSchema,
  calculateConsumption,
  DEFAULT_OBIS_CODE,
  describeObisCode,
  knownObisCodes,
  NOT_DELETED,
  obisSortIndex,
  prisma,
} from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";
import { clientIdentifier, rateLimit } from "../../../lib/rate-limit";
import {
  fieldErrorsFromZod,
  notFoundProblem,
  rateLimitedProblem,
  unprocessableProblem,
  validationProblem,
} from "../../../lib/api-problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Smart-home devices legitimately push often, but a misconfigured loop (or an
// attacker with a leaked token) should not be able to hammer the DB. Cap per
// source IP; generous enough for minute-interval telemetry from many meters.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

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
  const limit = rateLimit({
    key: `readings:${clientIdentifier(request)}`,
    limit: RATE_LIMIT,
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

  const parsed = apiReadingCreateSchema.safeParse(body);
  if (!parsed.success) {
    const errors = fieldErrorsFromZod(parsed.error);
    // `issues` in der alten Form bleibt erhalten.
    //
    // Dieses Feld gab es hier — und nur hier — schon vorher, mit `path` statt
    // `field`. Es umzubenennen und den alten Namen fallen zu lassen, wäre
    // dieselbe unfreundliche Änderung wie bei `error`: Sie zeigt sich erst,
    // wenn beim Aufrufer ohnehin etwas schiefgegangen ist. Veraltet, aber
    // vorhanden; entfernbar, sobald die Doku eine Frist genannt hat.
    return validationProblem(errors, undefined, {
      issues: errors.map((entry) => ({ path: entry.field, message: entry.message })),
    });
  }

  const {
    meterId,
    obisCode,
    value,
    timestamp,
    note,
    zaehlerGetauscht,
    startwertNeu,
    allowImplausible,
  } = parsed.data;
  const datum = timestamp ?? new Date();

  const zaehler = await prisma.zaehler.findUnique({
    where: { id: meterId },
    select: { id: true, name: true, einheit: true, aktiv: true },
  });
  if (!zaehler) {
    return notFoundProblem(`Kein Zähler mit der Id ${meterId}.`);
  }

  // ── Register auflösen ──────────────────────────────────────────────────────
  // Ohne Angabe gilt der Bezug: Genau dorthin schrieb jede bestehende
  // Automation vorher auch, und sie soll ohne Änderung weitermelden können.
  const code = obisCode ?? DEFAULT_OBIS_CODE;
  const described = describeObisCode(code);
  if (!described) {
    // Nicht stillschweigend anlegen: Ein Tippfehler eröffnete sonst eine zweite
    // Zeitreihe neben der richtigen, und das fällt erst Monate später auf.
    // Die bekannten Kennziffern kommen mit — das ist der Unterschied zwischen
    // „falsch" und „falsch, und hier stehen die richtigen". Als Erweiterungsfeld
    // neben `detail`, damit ein Client sie auswerten kann, ohne einen deutschen
    // Satz zu zerlegen.
    return validationProblem(
      [{ field: "obisCode", message: `Unbekannte OBIS-Kennziffer „${code}".` }],
      `Unbekannte OBIS-Kennziffer „${code}". Bekannt sind: ${knownObisCodes().join(", ")}.`,
      { knownObisCodes: knownObisCodes() },
    );
  }

  // Bekannte Kennziffer, aber noch kein Register: anlegen. Das ist der Weg, auf
  // dem die Einspeisung in Betrieb geht, ohne dass vorher jemand ein Formular
  // ausfüllen muss — der Zähler zählt bereits, und was jetzt nicht erfasst
  // wird, fehlt dauerhaft.
  const register = await prisma.meterRegister.upsert({
    where: { zaehlerId_obisCode: { zaehlerId: meterId, obisCode: code } },
    update: {},
    create: {
      zaehlerId: meterId,
      obisCode: code,
      richtung: described.richtung,
      tarif: described.tarif,
      einheit: zaehler.einheit,
      label: described.label,
      sortIndex: obisSortIndex(code),
    },
    select: { id: true, obisCode: true, richtung: true, label: true },
  });

  // Plausibilitätsprüfung über die bestehende Verbrauchslogik: den neuen Stand
  // provisorisch in die Historie einfügen und das dazugehörige Intervall prüfen.
  //
  // Auf DIESES Register begrenzt. Über den ganzen Zähler gerechnet liefen Bezug
  // und Einspeisung ineinander, und da beide unabhängig hochzählen, sähe fast
  // jeder Stand nach negativem Verbrauch aus — die Prüfung würde genau das
  // ablehnen, was sie schützen soll.
  //
  // `registerId: null` zählt zum Standardregister mit: Nach einem Rollback
  // schreibt die ältere Anwendung wieder ohne Registerbezug, und diese Stände
  // gehören derselben Reihe an.
  const existing = await prisma.ablesung.findMany({
    where:
      // Geloeschte Staende zaehlen nicht mit: Sonst pruefte der neue Wert gegen
      // eine Zahl, die die Oberflaeche nirgends mehr zeigt, und die Ablehnung
      // waere nicht nachvollziehbar.
      code === DEFAULT_OBIS_CODE
        ? { ...NOT_DELETED, zaehlerId: meterId, OR: [{ registerId: register.id }, { registerId: null }] }
        : { ...NOT_DELETED, registerId: register.id },
    select: { id: true, datum: true, wert: true, zaehlerGetauscht: true, startwertNeu: true },
  });
  const intervals = calculateConsumption([
    ...existing,
    { id: PENDING_ID, datum, wert: value, zaehlerGetauscht, startwertNeu: startwertNeu ?? null },
  ]);
  const newInterval = intervals.find((interval) => interval.toReadingId === PENDING_ID) ?? null;
  const isImplausible = newInterval !== null && newInterval.amount === null;

  if (isImplausible && !allowImplausible) {
    return unprocessableProblem(
      "Unplausibler Zählerstand: Der Verbrauch seit der vorherigen Ablesung wäre negativ. " +
        "Bei einem Zählertausch `zaehlerGetauscht`/`startwertNeu` senden, oder `allowImplausible: true`.",
      {
        plausibility: {
          from: newInterval?.from?.toISOString() ?? null,
          to: newInterval?.to.toISOString() ?? null,
          value,
          register: register.obisCode,
        },
      },
    );
  }

  const created = await prisma.ablesung.create({
    data: {
      zaehlerId: meterId,
      registerId: register.id,
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
        // Wird immer mitgeschickt, auch wenn der Aufrufer nichts angegeben hat:
        // Eine Automation, die versehentlich auf dem Bezug landet statt auf der
        // Einspeisung, soll das an ihrer eigenen Antwort sehen können.
        register: {
          obisCode: register.obisCode,
          direction: register.richtung,
          label: register.label,
        },
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
