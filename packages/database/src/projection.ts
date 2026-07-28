import {
  calculateConsumption,
  type ConsumptionInputReading,
} from "./consumption";
import type { EnergyCategoryValue } from "./categories";
import { convertGasToKwh, type GasFactorInput } from "./gas";
import { calculateTariffCost, pickTariffForDate, type TariffInput } from "./tariff";

// Verbrauchs-Hochrechnung auf ein Jahr.
//
// GLEITENDES JAHR statt Kalenderjahr: die Hochrechnung bezieht sich auf das
// Fenster [jüngste Ablesung − 12 Monate, jüngste Ablesung], NICHT auf
// „01.01. bis heute". Der Grund ist die reale Ablesekadenz — viele Zähler
// werden nur ein- bis zweimal im Jahr abgelesen (Jahresablesung). Im laufenden
// Kalenderjahr steht dann oft gar keine Ablesung, sodass eine Kalenderjahr-
// Hochrechnung schlicht „zu wenig Daten" liefert. Das gleitende Jahr nutzt
// dagegen immer die zuletzt verfügbaren ~12 Monate und vergleicht sie mit den
// 12 Monaten davor.
//
// Zwei Verfahren:
//   • linear    – gleichmäßige Extrapolation (Ø-Verbrauch × Jahrestage).
//   • saisonal  – gewichtet nach einem monatlichen Verbrauchsprofil, sodass
//                 z. B. hoher Gas-/Heizverbrauch im Winter nicht naiv aufs
//                 ganze Jahr hochgerechnet wird.
// Beide teilen dieselbe Formel; „linear" ist schlicht das saisonale Verfahren
// mit einem flachen Profil (jeder Monat = 1,0). Bei einem vollständig
// abgedeckten Jahr (der Normalfall bei Jahresablesungen) ist die Hochrechnung
// ohnehin exakt der gemessene Jahresverbrauch.

const MS_PER_DAY = 86_400_000;

export type ProjectionMethod = "linear" | "seasonal" | "auto";
export type ProjectionConfidence = "low" | "medium" | "high";

// Monatsgewichte (Index 0 = Januar … 11 = Dezember), relativ zum
// Durchschnittsmonat ≈ 1,0. Nur die Verhältnisse zählen, nicht die exakte
// Summe. Werte sind typische Profile für DE (Heizprofil bzw. PV-Ertragskurve).
const FLAT_PROFILE: number[] = Array.from({ length: 12 }, () => 1);

const SEASONAL_PROFILES: Partial<Record<EnergyCategoryValue, number[]>> = {
  // Heizlast: winterlastig, aber im Sommer nie null (Warmwasser-Grundlast).
  GAS: [1.85, 1.65, 1.35, 0.95, 0.6, 0.4, 0.35, 0.35, 0.55, 0.95, 1.4, 1.7],
  // PV-Ertrag: sommerlastig.
  PV_ERZEUGUNG: [0.3, 0.5, 0.85, 1.2, 1.55, 1.65, 1.7, 1.5, 1.1, 0.7, 0.35, 0.25],
  PV_EINSPEISUNG: [0.3, 0.5, 0.85, 1.2, 1.55, 1.65, 1.7, 1.5, 1.1, 0.7, 0.35, 0.25],
};

function resolveMethod(kategorie: EnergyCategoryValue, method: ProjectionMethod): "linear" | "seasonal" {
  if (method === "auto") return SEASONAL_PROFILES[kategorie] ? "seasonal" : "linear";
  return method;
}

function profileFor(kategorie: EnergyCategoryValue, method: "linear" | "seasonal"): number[] {
  if (method === "linear") return FLAT_PROFILE;
  return SEASONAL_PROFILES[kategorie] ?? FLAT_PROFILE;
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Aufsummierte Tagesgewichte im Fenster [from, to) nach dem Monatsprofil. */
function weightMass(from: Date, to: Date, profile: number[]): number {
  let mass = 0;
  const cursor = utcDay(from);
  const end = to.getTime();
  // Bruchteil des ersten Tages ignorieren wir bewusst — bei Fenstern über
  // Wochen/Monate ist der Fehler vernachlässigbar und der Code bleibt simpel.
  while (cursor.getTime() < end) {
    mass += profile[cursor.getUTCMonth()];
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return mass;
}

interface WindowAllocation {
  /** Anteilig dem Fenster zugerechneter (plausibler) Verbrauch. */
  consumption: number;
  /** Abgedeckte Tage im Fenster (mit tatsächlichen Daten). */
  coveredDays: number;
  /** Gewichtete Masse der abgedeckten Zeit nach Monatsprofil. */
  coveredWeight: number;
}

/**
 * Verteilt Intervall-Verbräuche anteilig auf ein Datumsfenster [from, to).
 * Ein Intervall, das die Fenstergrenze überschreitet, wird linear (nach Tagen)
 * aufgeteilt — so lässt sich der Jahresanteil auch dann sauber bestimmen, wenn
 * eine Ablesung über den Jahreswechsel reicht.
 */
function allocateWindow(
  readings: ConsumptionInputReading[],
  from: Date,
  to: Date,
  profile: number[],
): WindowAllocation {
  const intervals = calculateConsumption(readings);
  const windowFrom = from.getTime();
  const windowTo = to.getTime();

  let consumption = 0;
  let coveredDays = 0;
  let coveredWeight = 0;

  for (const interval of intervals) {
    if (interval.amount === null || interval.from === null) continue;
    // interval.from ist das Datum der vorherigen Ablesung (Intervallbeginn).
    const startMs = interval.from.getTime();
    const endMs = interval.to.getTime();
    const spanMs = endMs - startMs;
    if (spanMs <= 0) continue;

    const overlapStart = Math.max(startMs, windowFrom);
    const overlapEnd = Math.min(endMs, windowTo);
    if (overlapEnd <= overlapStart) continue;

    const fraction = (overlapEnd - overlapStart) / spanMs;
    consumption += interval.amount * fraction;
    coveredDays += (overlapEnd - overlapStart) / MS_PER_DAY;
    coveredWeight += weightMass(new Date(overlapStart), new Date(overlapEnd), profile);
  }

  return { consumption, coveredDays, coveredWeight };
}

export interface ConsumptionProjectionInput {
  readings: ConsumptionInputReading[];
  kategorie: EnergyCategoryValue;
  einheit: string;
  tarife?: TariffInput[];
  /**
   * Gepflegte Umrechnungsfaktoren (nur Gas).
   *
   * Fehlen sie, bleiben die hochgerechneten KOSTEN leer. Das ist Absicht: Der
   * Brennwert aendert sich monatlich, und mit einem Wert von 2021 zu rechnen
   * ergaebe eine Zahl, die aussieht wie eine Schaetzung aus Daten, aber eine
   * Schaetzung aus einer Annahme ist.
   */
  gasFaktoren?: GasFactorInput[];
  method?: ProjectionMethod;
  /** Referenzzeitpunkt („jetzt"); Default: aktuelles Datum. */
  now?: Date;
}

export interface ConsumptionProjection {
  method: "linear" | "seasonal";
  /** Bezugsjahr = Jahr der Anker-Ablesung (jüngste Ablesung). */
  year: number;
  unit: string;
  /** Enddatum des gleitenden Jahres (ISO) — die jüngste Ablesung. */
  anchorDate: string;
  /** Verbrauch im gleitenden Jahr [anchor − 12 M, anchor] (erfasster Anteil). */
  windowConsumption: number;
  /** Tage mit Datenabdeckung im gleitenden Jahr. */
  coveredDays: number;
  /** Länge des gleitenden Jahres in Tagen (~365). */
  windowDays: number;
  /** Hochgerechnete Jahressumme; `null`, wenn zu wenig Daten. */
  projectedAnnual: number | null;
  /** Hochgerechnete Jahreskosten (Tarif); `null` ohne Tarif/Prognose. */
  projectedAnnualCost: number | null;
  /** Verbrauch im gesamten Vorjahr; `null`, wenn keine Vorjahresdaten. */
  previousYearConsumption: number | null;
  /** Vorjahreskosten auf Tarifbasis; `null` ohne Tarif/Daten. */
  previousYearCost: number | null;
  /** Änderung Prognose vs. Vorjahr in Prozent. */
  deltaConsumptionPct: number | null;
  deltaCostPct: number | null;
  confidence: ProjectionConfidence;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function tariffCostFor(
  tarife: TariffInput[] | undefined,
  at: Date,
  consumption: number,
  isGas: boolean,
  gasFaktoren?: GasFactorInput[],
): number | null {
  if (!tarife || tarife.length === 0) return null;
  const tarif = pickTariffForDate(
    tarife.map((t) => ({ ...t, gueltigAb: toDate(t.gueltigAb), gueltigBis: t.gueltigBis ? toDate(t.gueltigBis) : null })),
    at,
  );
  if (!tarif) return null;

  if (!isGas) return calculateTariffCost(tarif, consumption, 365);

  // Die Hochrechnung blickt ein Jahr zurueck — genau der Zeitraum, ueber den
  // sich der Brennwert mehrfach geaendert hat. Ihn faktorweise umzurechnen ist
  // deshalb kein Detail, sondern der Unterschied zwischen einer Schaetzung aus
  // Daten und einer aus einer Annahme von 2021.
  const jahresBeginn = new Date(at.getTime() - YEAR_MS);
  const converted = convertGasToKwh(consumption, jahresBeginn, at, gasFaktoren ?? []);
  // Kein Faktor, keine Kostenzahl. Siehe `gasFaktoren` oben.
  if (converted.kwh === null) return null;
  return calculateTariffCost(tarif, converted.kwh, 365);
}

/**
 * Rechnet aus den bisherigen Ablesungen die Jahressumme (und -kosten) hoch und
 * vergleicht sie mit dem Vorjahr. Rein funktional — nutzbar in Server- wie
 * Client-Komponenten.
 */
/** Länge des gleitenden Jahres. Schaltjahr-Feinheiten sind hier vernachlässigbar. */
const YEAR_MS = 365 * MS_PER_DAY;

export function projectAnnualConsumption(input: ConsumptionProjectionInput): ConsumptionProjection {
  const now = input.now ?? new Date();
  const isGas = input.kategorie === "GAS";
  const resolvedMethod = resolveMethod(input.kategorie, input.method ?? "auto");
  const profile = profileFor(input.kategorie, resolvedMethod);

  const readings = [...input.readings].sort((a, b) => a.datum.getTime() - b.datum.getTime());
  const lastReading = readings.at(-1) ?? null;

  // Anker = jüngste Ablesung, höchstens aber „jetzt": eine (versehentlich) in
  // die Zukunft datierte Ablesung soll nicht in die Zukunft hochrechnen. Ohne
  // Ablesung gibt es nichts zu projizieren — Anker auf „jetzt", Fenster bleibt
  // leer und das Ergebnis ist eine leere Prognose.
  const anchorMs = lastReading
    ? Math.min(lastReading.datum.getTime(), now.getTime())
    : now.getTime();
  const anchor = new Date(anchorMs);
  const year = anchor.getUTCFullYear();

  const curFrom = new Date(anchorMs - YEAR_MS);
  const prevTo = curFrom;
  const prevFrom = new Date(anchorMs - 2 * YEAR_MS);

  // Gleitendes Jahr bis zum Anker: erfasster Verbrauch, deckungsnormiert auf die
  // volle (saisonal gewichtete) Jahresmasse hochgerechnet. Bei einer sauberen
  // Jahresablesung deckt genau ein Intervall das Fenster ab → die Hochrechnung
  // ist exakt der gemessene Jahresverbrauch.
  const cur = allocateWindow(readings, curFrom, anchor, profile);
  const totalWeight = weightMass(curFrom, anchor, profile);
  const windowDays = (anchorMs - curFrom.getTime()) / MS_PER_DAY;
  const projectedAnnual =
    cur.coveredWeight > 0 ? (cur.consumption * totalWeight) / cur.coveredWeight : null;

  // Vorjahr = das gleitende Jahr davor. Ein volles Jahr braucht keine saisonale
  // Umverteilung (flaches Profil); bei nur teilweiser Abdeckung ebenso
  // deckungsnormiert, damit ein angebrochenes Vorjahr den Vergleich nicht
  // künstlich nach unten zieht.
  const prev = allocateWindow(readings, prevFrom, prevTo, FLAT_PROFILE);
  const prevWeight = weightMass(prevFrom, prevTo, FLAT_PROFILE);
  const previousYearConsumption =
    prev.coveredWeight > 0 ? (prev.consumption * prevWeight) / prev.coveredWeight : null;

  const projectedAnnualCost =
    projectedAnnual !== null
      ? tariffCostFor(input.tarife, anchor, projectedAnnual, isGas, input.gasFaktoren)
      : null;
  const previousYearCost =
    previousYearConsumption !== null
      ? tariffCostFor(
          input.tarife,
          new Date(anchorMs - YEAR_MS),
          previousYearConsumption,
          isGas,
          input.gasFaktoren,
        )
      : null;

  const deltaConsumptionPct =
    projectedAnnual !== null && previousYearConsumption && previousYearConsumption > 0
      ? ((projectedAnnual - previousYearConsumption) / previousYearConsumption) * 100
      : null;
  const deltaCostPct =
    projectedAnnualCost !== null && previousYearCost && previousYearCost > 0
      ? ((projectedAnnualCost - previousYearCost) / previousYearCost) * 100
      : null;

  // Konfidenz nach Datenabdeckung des gleitenden Jahres: ein voll abgedecktes
  // Jahr (Jahresablesung) ist „hoch", eine kurze Messstrecke „niedrig".
  const coverageFraction = windowDays > 0 ? cur.coveredDays / windowDays : 0;
  let confidence: ProjectionConfidence;
  if (projectedAnnual === null || cur.coveredDays < 30) {
    confidence = "low";
  } else if (coverageFraction < 0.5) {
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return {
    method: resolvedMethod,
    year,
    unit: input.einheit,
    anchorDate: anchor.toISOString(),
    windowConsumption: cur.consumption,
    coveredDays: cur.coveredDays,
    windowDays,
    projectedAnnual,
    projectedAnnualCost,
    previousYearConsumption,
    previousYearCost,
    deltaConsumptionPct,
    deltaCostPct,
    confidence,
  };
}
