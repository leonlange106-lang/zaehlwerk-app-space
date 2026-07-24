import {
  calculateConsumption,
  calculateTariffCost,
  computeConsumptionStats,
  pickTariffForDate,
  type EnergyCategoryValue,
  type TariffInput,
} from "@zaehlwerk/database/shared";

// Gas m³ → kWh = Verbrauch × Brennwert × Zustandszahl. Werte aus dem
// Original-Projekt (Za_hler.xlsm, m_html.bas, Stand 2021+). Ideal wäre ein
// zähler-/periodenspezifischer Brennwert; bis wir den je Zähler speichern,
// nutzen wir diese dokumentierten Konstanten (effektiver Faktor ≈ 9,92).
export const GAS_BRENNWERT = 10.312; // kWh/m³
export const GAS_ZUSTANDSZAHL = 0.9622;
export const GAS_KWH_FACTOR = GAS_BRENNWERT * GAS_ZUSTANDSZAHL;

// Vor der Euro-Bargeldeinführung galt in den Altdaten DM (Original-Grenze:
// 18.09.2001). Kostenbeträge davor werden in DM ausgewiesen.
const EURO_CUTOFF_MS = Date.UTC(2001, 8, 18); // Monat 8 = September

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
  /** Hinterlegte Tarife — für die Kostenberechnung, wenn kein Betrag erfasst ist. */
  tarife?: TariffInput[];
}

/** Eine Sparten-Zelle einer Datums-Zeile (Intervall, das an diesem Datum endet). */
export interface UtilityCell {
  /** Intervall-Verbrauch; `null` = unplausibel (negativer Wert). */
  consumption: number | null;
  /** Nur Gas: Verbrauch in kWh (m³ × Brennwert × Zustandszahl). */
  consumptionKwh: number | null;
  days: number;
  cost: number | null;
  /** Zählertausch an dieser Ablesung. */
  swap: boolean;
}

/** Eine Zeile des Berichts = ein Ablesedatum über alle drei Sparten hinweg. */
export interface ReportRow {
  /** ISO-Datum (yyyy-mm-dd) der Ablesung. */
  date: string;
  /** Datum liegt vor der Euro-Umstellung → Kosten in DM. */
  dm: boolean;
  strom: UtilityCell | null;
  gas: UtilityCell | null;
  wasser: UtilityCell | null;
}

/** Kompakte Zusammenfassung eines Zählers (für zusätzliche Zähler außerhalb der 3 Spalten). */
export interface ReportMeterRow {
  id: string;
  name: string;
  sparte: Sparte;
  einheit: string;
  totalConsumption: number;
  totalConsumptionKwh: number | null;
  avgPerDay: number | null;
  totalCost: number;
  hasImplausible: boolean;
}

export interface YearlyReportData {
  generatedAt: string;
  rows: ReportRow[];
  /** Namen der als Spalte verwendeten Primärzähler (für eine dezente Fußzeile). */
  columns: { strom: string | null; gas: string | null; wasser: string | null };
  gasBrennwert: number;
  gasZustandszahl: number;
  /** Weitere Zähler, die nicht in den drei Hauptspalten stehen. */
  extras: ReportMeterRow[];
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Kosten eines Intervalls: erfasster Betrag hat Vorrang, sonst tarifbasiert aus
 * den hinterlegten Tarifen berechnet. `null`, wenn beides fehlt.
 */
function intervalCost(
  meter: ReportZaehlerInput,
  amount: number | null,
  days: number,
  endDate: Date,
  recorded: number | null,
): number | null {
  if (recorded != null) return recorded;
  if (amount === null || !meter.tarife || meter.tarife.length === 0) return null;
  const tarif = pickTariffForDate(meter.tarife, endDate);
  if (!tarif) return null;
  const verbrauch = kategorieToSparte(meter.kategorie) === "Gas" ? amount * GAS_KWH_FACTOR : amount;
  return calculateTariffCost(tarif, verbrauch, days);
}

/**
 * Baut die Datum→Zelle-Zuordnung für einen Zähler einer Sparte.
 *
 * Zählertausch-Faltung: ein Intervall, das an einer Tausch-Ablesung endet, ist
 * nur die Teilstrecke auf dem ALTEN Zähler (letzter Stand alt − vorherige
 * Ablesung). Es bildet KEINE eigene Jahreszeile, sondern wird auf die nächste
 * ECHTE Ablesung übertragen und dort mit der Neu-Zähler-Strecke (neue Ablesung −
 * Startwert neu) zu einem vollen Jahr zusammengefasst. Genau so wird der
 * Zählertausch von Hand geführt: der Jahresverbrauch läuft von der letzten
 * richtigen Ablesung (≈ 12 Monate vorher) bis zum Endstand des Altgeräts PLUS
 * vom Startwert des Neugeräts bis zur neuen Ablesung. Die Tausch-Ablesung selbst
 * bleibt eine reine „Zählertausch"-Markierung ohne eigene Jahreszahl.
 */
function buildCellMap(meter: ReportZaehlerInput | undefined, sparte: Sparte): Map<string, UtilityCell> {
  const map = new Map<string, UtilityCell>();
  if (!meter) return map;

  const ascending = [...meter.ablesungen].sort((a, b) => a.datum.getTime() - b.datum.getTime());
  const intervals = calculateConsumption(ascending);
  const byReadingId = new Map(ascending.map((reading) => [reading.id, reading]));

  // Erst-Ablesung = Installations-Stand: der Zähler startet bei 0, der erste
  // abgelesene Wert ist der Verbrauch seit dem Einbau. Er bildet eine eigene
  // Zeile mit 0 Tagen (kein Vorintervall → keine Rate, keine Kosten). Der
  // Referenz-Bericht führt diese Zeile ebenso, und die Gesamtsumme je Zähler
  // rechnet sie mit (Zähler-Lebensverbrauch = Endstand − 0). Bewusst hier im
  // Bericht statt in `calculateConsumption`, damit die Kernlogik keinen
  // mitten im Leben übernommenen Zähler (erster Stand ≠ 0) fälschlich als
  // Verbrauch verbucht.
  const first = ascending[0];
  if (first) {
    map.set(toIsoDate(first.datum), {
      consumption: first.zaehlerGetauscht ? null : first.wert,
      consumptionKwh:
        sparte === "Gas" && !first.zaehlerGetauscht ? first.wert * GAS_KWH_FACTOR : null,
      days: 0,
      cost: first.kosten,
      swap: first.zaehlerGetauscht,
    });
  }

  // Über offene Tausch-Strecken zurückgestellter Verbrauch + Tage, bis die
  // nächste echte Ablesung sie aufnimmt.
  let carryAmount = 0;
  let carryDays = 0;
  let carryImplausible = false;
  let carrying = false;

  for (const interval of intervals) {
    const ending = byReadingId.get(interval.toReadingId);
    if (!ending) continue;

    if (ending.zaehlerGetauscht) {
      // Tausch-Zeile: nur Markierung, Verbrauch der Altgerät-Strecke zurückstellen.
      map.set(toIsoDate(ending.datum), {
        consumption: null,
        consumptionKwh: null,
        days: interval.days,
        cost: null,
        swap: true,
      });
      carrying = true;
      carryDays += interval.days;
      if (interval.amount === null) carryImplausible = true;
      else carryAmount += interval.amount;
      continue;
    }

    // Echte Ablesung: eine ggf. offene Tausch-Strecke einrechnen.
    const amount = carrying
      ? carryImplausible || interval.amount === null
        ? null
        : carryAmount + interval.amount
      : interval.amount;
    const days = carrying ? carryDays + interval.days : interval.days;

    map.set(toIsoDate(ending.datum), {
      consumption: amount,
      consumptionKwh: sparte === "Gas" && amount !== null ? amount * GAS_KWH_FACTOR : null,
      days,
      cost: intervalCost(meter, amount, days, ending.datum, ending.kosten),
      swap: false,
    });

    carrying = false;
    carryAmount = 0;
    carryDays = 0;
    carryImplausible = false;
  }
  return map;
}

function buildMeterRow(zaehler: ReportZaehlerInput): ReportMeterRow {
  const ascending = [...zaehler.ablesungen].sort((a, b) => a.datum.getTime() - b.datum.getTime());
  const intervals = calculateConsumption(ascending);
  const stats = computeConsumptionStats(intervals);
  const sparte = kategorieToSparte(zaehler.kategorie);
  const byReadingId = new Map(ascending.map((reading) => [reading.id, reading]));

  const totalCost = intervals.reduce((sum, interval) => {
    const ending = byReadingId.get(interval.toReadingId);
    if (!ending) return sum;
    const cost = intervalCost(zaehler, interval.amount, interval.days, ending.datum, ending.kosten);
    return sum + (cost ?? 0);
  }, 0);

  return {
    id: zaehler.id,
    name: zaehler.name,
    sparte,
    einheit: zaehler.einheit,
    totalConsumption: stats.total,
    totalConsumptionKwh: sparte === "Gas" ? stats.total * GAS_KWH_FACTOR : null,
    avgPerDay: stats.avgPerDay,
    totalCost,
    hasImplausible: stats.hasImplausibleIntervals,
  };
}

/**
 * Baut den originalgetreuen Bericht: Datums-Zeilen × Sparten-Spalten. Für die
 * drei festen Spalten wird je der PRIMÄRE (erste) Strom-, Gas- und
 * Wasserzähler verwendet; weitere Zähler landen in `extras`.
 */
export function buildYearlyReport(
  zaehlerList: ReportZaehlerInput[],
  generatedAt: Date = new Date(),
): YearlyReportData {
  const firstOf = (sparte: Sparte) =>
    zaehlerList.find((zaehler) => kategorieToSparte(zaehler.kategorie) === sparte);
  const strom = firstOf("Strom");
  const gas = firstOf("Gas");
  const wasser = firstOf("Wasser");

  const stromMap = buildCellMap(strom, "Strom");
  const gasMap = buildCellMap(gas, "Gas");
  const wasserMap = buildCellMap(wasser, "Wasser");

  const dates = [...new Set([...stromMap.keys(), ...gasMap.keys(), ...wasserMap.keys()])].sort();
  const rows: ReportRow[] = dates.map((date) => ({
    date,
    dm: Date.parse(`${date}T00:00:00Z`) < EURO_CUTOFF_MS,
    strom: stromMap.get(date) ?? null,
    gas: gasMap.get(date) ?? null,
    wasser: wasserMap.get(date) ?? null,
  }));

  const primaryIds = new Set([strom?.id, gas?.id, wasser?.id].filter(Boolean));
  const extras = zaehlerList
    .filter((zaehler) => !primaryIds.has(zaehler.id))
    .map(buildMeterRow);

  return {
    generatedAt: generatedAt.toISOString(),
    rows,
    columns: { strom: strom?.name ?? null, gas: gas?.name ?? null, wasser: wasser?.name ?? null },
    gasBrennwert: GAS_BRENNWERT,
    gasZustandszahl: GAS_ZUSTANDSZAHL,
    extras,
  };
}
