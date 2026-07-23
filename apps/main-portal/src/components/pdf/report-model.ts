import {
  calculateConsumption,
  computeConsumptionStats,
  type EnergyCategoryValue,
} from "@zaehlwerk/database/shared";

/**
 * Umrechnungsfaktor Gas m³ → kWh (Brennwert × Zustandszahl). Das echte
 * Referenzprojekt speichert den Brennwert je Zähler (`zusatzfelder`), was
 * dieses Portal (noch) nicht tut — siehe die "out of scope"-Notiz im Audit-PR.
 * Bis dahin nutzen wir einen dokumentierten deutschen Durchschnittswert; die
 * kWh-Spalte im Bericht ist entsprechend als Näherung gekennzeichnet.
 */
export const GAS_KWH_FACTOR = 10.3;

export type Sparte = "Strom" | "Gas" | "Wasser" | "PV" | "Sonstiges";

export function kategorieToSparte(kategorie: EnergyCategoryValue): Sparte {
  switch (kategorie) {
    case "STROM":
      return "Strom";
    case "GAS":
      return "Gas";
    case "WASSER":
      return "Wasser";
    case "PV_ERZEUGUNG":
    case "PV_EINSPEISUNG":
      return "PV";
    default:
      return "Sonstiges";
  }
}

/** Minimal-Form einer Ablesung, wie sie der Report braucht (aus der DB oder Tests). */
export interface ReportReadingInput {
  id: string;
  datum: Date;
  wert: number;
  zaehlerGetauscht: boolean;
  startwertNeu: number | null;
  kosten: number | null;
}

export interface ReportZaehlerInput {
  id: string;
  name: string;
  kategorie: EnergyCategoryValue;
  einheit: string;
  ablesungen: ReportReadingInput[];
}

/** Eine Zeile je Zähler mit allen für die 5 Report-Sektionen nötigen Kennzahlen. */
export interface ReportMeterRow {
  id: string;
  name: string;
  sparte: Sparte;
  einheit: string;
  periodFrom: string | null;
  periodTo: string | null;
  firstValue: number | null;
  lastValue: number | null;
  totalConsumption: number;
  /** Nur für Gas gesetzt (m³ → kWh), sonst null. */
  totalConsumptionKwh: number | null;
  avgPerDay: number | null;
  totalDays: number;
  totalCost: number;
  costPerDay: number | null;
  costPerUnit: number | null;
  hasImplausible: boolean;
  /** ISO-Daten der Ablesungen, bei denen ein Zählertausch stattfand. */
  meterSwaps: string[];
}

export interface YearlyReportData {
  generatedAt: string;
  rows: ReportMeterRow[];
  grandTotalCost: number;
  /** Summe der Pro-Tag-Kosten über alle Zähler (kombinierte Tagesrate). */
  totalCostPerDay: number;
  gasKwhFactor: number;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Baut die vollständige Report-Struktur aus rohen Zähler-/Ablesungsdaten. */
export function buildYearlyReport(
  zaehlerList: ReportZaehlerInput[],
  generatedAt: Date = new Date(),
): YearlyReportData {
  const rows: ReportMeterRow[] = zaehlerList.map((zaehler) => {
    const ascending = [...zaehler.ablesungen].sort(
      (a, b) => a.datum.getTime() - b.datum.getTime(),
    );
    const intervals = calculateConsumption(ascending);
    const stats = computeConsumptionStats(intervals);
    const sparte = kategorieToSparte(zaehler.kategorie);

    const first = ascending[0] ?? null;
    const last = ascending[ascending.length - 1] ?? null;
    const totalCost = ascending.reduce((sum, r) => sum + (r.kosten ?? 0), 0);
    const totalConsumption = stats.total;

    return {
      id: zaehler.id,
      name: zaehler.name,
      sparte,
      einheit: zaehler.einheit,
      periodFrom: first ? toIsoDate(first.datum) : null,
      periodTo: last ? toIsoDate(last.datum) : null,
      firstValue: first ? first.wert : null,
      lastValue: last ? last.wert : null,
      totalConsumption,
      totalConsumptionKwh: sparte === "Gas" ? totalConsumption * GAS_KWH_FACTOR : null,
      avgPerDay: stats.avgPerDay,
      totalDays: stats.totalDays,
      totalCost,
      costPerDay: stats.totalDays > 0 ? totalCost / stats.totalDays : null,
      costPerUnit: totalConsumption > 0 ? totalCost / totalConsumption : null,
      hasImplausible: stats.hasImplausibleIntervals,
      meterSwaps: ascending
        .filter((r) => r.zaehlerGetauscht)
        .map((r) => toIsoDate(r.datum)),
    };
  });

  return {
    generatedAt: generatedAt.toISOString(),
    rows,
    grandTotalCost: rows.reduce((sum, row) => sum + row.totalCost, 0),
    totalCostPerDay: rows.reduce((sum, row) => sum + (row.costPerDay ?? 0), 0),
    gasKwhFactor: GAS_KWH_FACTOR,
  };
}
