import {
  calculateConsumption,
  type ConsumptionInputReading,
} from "./consumption";
import type { EnergyCategoryValue } from "./categories";
import { gasM3ToKwh } from "./gas";
import { calculateTariffCost, pickTariffForDate, type TariffInput } from "./tariff";

// Verbrauchs-Hochrechnung: aus den bisherigen Ablesungen des laufenden Jahres
// eine Jahressumme (und -kosten) schätzen. Zwei Verfahren:
//   • linear    – gleichmäßige Extrapolation (Ø-Verbrauch × Jahrestage).
//   • saisonal  – gewichtet nach einem monatlichen Verbrauchsprofil, sodass
//                 z. B. hoher Gas-/Heizverbrauch im Winter nicht naiv aufs
//                 ganze Jahr hochgerechnet wird.
// Beide teilen dieselbe Formel; „linear" ist schlicht das saisonale Verfahren
// mit einem flachen Profil (jeder Monat = 1,0).

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
  method?: ProjectionMethod;
  /** Referenzzeitpunkt („jetzt"); Default: aktuelles Datum. */
  now?: Date;
}

export interface ConsumptionProjection {
  method: "linear" | "seasonal";
  year: number;
  unit: string;
  /** Verbrauch im laufenden Jahr bis `now` (anteilig). */
  ytdConsumption: number;
  /** Tage mit Datenabdeckung im laufenden Jahr. */
  coveredDays: number;
  /** Bereits vergangene Tage des Jahres. */
  elapsedDays: number;
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
): number | null {
  if (!tarife || tarife.length === 0) return null;
  const tarif = pickTariffForDate(
    tarife.map((t) => ({ ...t, gueltigAb: toDate(t.gueltigAb), gueltigBis: t.gueltigBis ? toDate(t.gueltigBis) : null })),
    at,
  );
  if (!tarif) return null;
  const verbrauch = isGas ? gasM3ToKwh(consumption) : consumption;
  return calculateTariffCost(tarif, verbrauch, 365);
}

/**
 * Rechnet aus den bisherigen Ablesungen die Jahressumme (und -kosten) hoch und
 * vergleicht sie mit dem Vorjahr. Rein funktional — nutzbar in Server- wie
 * Client-Komponenten.
 */
export function projectAnnualConsumption(input: ConsumptionProjectionInput): ConsumptionProjection {
  const now = input.now ?? new Date();
  const year = now.getUTCFullYear();
  const isGas = input.kategorie === "GAS";
  const resolvedMethod = resolveMethod(input.kategorie, input.method ?? "auto");
  const profile = profileFor(input.kategorie, resolvedMethod);

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const prevStart = new Date(Date.UTC(year - 1, 0, 1));
  const prevEnd = yearStart;

  const readings = [...input.readings].sort((a, b) => a.datum.getTime() - b.datum.getTime());

  const ytd = allocateWindow(readings, yearStart, now, profile);
  const totalWeight = weightMass(yearStart, yearEnd, profile);
  const elapsedDays = Math.max(0, (now.getTime() - yearStart.getTime()) / MS_PER_DAY);
  const daysInYear = (yearEnd.getTime() - yearStart.getTime()) / MS_PER_DAY;

  const projectedAnnual =
    ytd.coveredWeight > 0 ? (ytd.consumption * totalWeight) / ytd.coveredWeight : null;

  // Vorjahr braucht keine Gewichtung — es ist ein vollständiges Jahr.
  const prev = allocateWindow(readings, prevStart, prevEnd, FLAT_PROFILE);
  const previousYearConsumption = prev.coveredDays > 0 ? prev.consumption : null;

  const projectedAnnualCost =
    projectedAnnual !== null ? tariffCostFor(input.tarife, now, projectedAnnual, isGas) : null;
  const previousYearCost =
    previousYearConsumption !== null
      ? tariffCostFor(input.tarife, new Date(Date.UTC(year - 1, 6, 1)), previousYearConsumption, isGas)
      : null;

  const deltaConsumptionPct =
    projectedAnnual !== null && previousYearConsumption && previousYearConsumption > 0
      ? ((projectedAnnual - previousYearConsumption) / previousYearConsumption) * 100
      : null;
  const deltaCostPct =
    projectedAnnualCost !== null && previousYearCost && previousYearCost > 0
      ? ((projectedAnnualCost - previousYearCost) / previousYearCost) * 100
      : null;

  const elapsedFraction = elapsedDays / daysInYear;
  let confidence: ProjectionConfidence;
  if (projectedAnnual === null || ytd.coveredDays < 14 || elapsedFraction < 0.08) {
    confidence = "low";
  } else if (ytd.coveredDays < 60 || elapsedFraction < 0.25) {
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return {
    method: resolvedMethod,
    year,
    unit: input.einheit,
    ytdConsumption: ytd.consumption,
    coveredDays: ytd.coveredDays,
    elapsedDays,
    projectedAnnual,
    projectedAnnualCost,
    previousYearConsumption,
    previousYearCost,
    deltaConsumptionPct,
    deltaCostPct,
    confidence,
  };
}
