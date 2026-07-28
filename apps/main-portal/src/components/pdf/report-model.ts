import {
  calculateConsumption,
  calculateTariffCost,
  computeConsumptionStats,
  pickTariffForDate,
  convertGasToKwh,
  GAS_BRENNWERT,
  GAS_KWH_FACTOR,
  GAS_ZUSTANDSZAHL,
  type EnergyCategoryValue,
  type GasFactorInput,
  type TariffInput,
} from "@zaehlwerk/database/shared";

// Gas m³ → kWh = Verbrauch × Brennwert × Zustandszahl.
//
// Die Konstanten kommen aus `packages/database/src/gas.ts` und werden hier
// bewusst NICHT noch einmal geschrieben. Sie standen als zweite Kopie in dieser
// Datei, obwohl die kanonische Datei von sich sagt, der PDF-Report nutze sie —
// zwei Wahrheiten, von denen bei der ersten Korrektur eine zurückgeblieben
// wäre. Der Report weist den verwendeten Faktor in der Fußzeile aus; sobald er
// je Zähler und Zeitraum gepflegt wird, muss diese Anzeige mitwandern.
export { GAS_BRENNWERT, GAS_KWH_FACTOR, GAS_ZUSTANDSZAHL };

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
  /**
   * Gepflegte Gas-Umrechnungsfaktoren.
   *
   * Fehlen sie ganz, greift der feste Faktor von 2021 — der Bericht sagt das
   * dann in der Fußzeile. Fehlt einer nur für einen TEIL des Zeitraums, bleibt
   * die kWh-Zahl dieses Intervalls leer: In einem PDF, das jemand zur
   * Abrechnung nimmt, ist eine Lücke besser als eine geratene Zahl.
   */
  umrechnungsfaktoren?: GasFactorInput[];
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
  /** Der feste Notnagel-Faktor — nur noch für Zähler ohne gepflegten Faktor. */
  gasBrennwert: number;
  gasZustandszahl: number;
  /** Die tatsächlich verwendeten Faktoren mit ihrem Zeitraum. */
  gasFaktoren: Array<{ von: string; bis: string | null; brennwert: number; zustandszahl: number }>;
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
/**
 * m³ → kWh für den Bericht.
 *
 * Sind Faktoren gepflegt, wird faktorweise und über den Zeitraum gerechnet;
 * fehlt für einen Teil davon einer, kommt `null` heraus — in einem PDF, das
 * jemand zur Abrechnung nimmt, ist eine Lücke besser als eine geratene Zahl.
 *
 * Ist GAR KEIN Faktor gepflegt, greift der feste von 2021. Das ist der
 * Notnagel, und die Fußzeile sagt dann, dass gerechnet wurde wie bisher —
 * sonst verlöre jeder Bestandsbericht ohne Zutun seine kWh-Spalte.
 */
function gasKwh(
  meter: ReportZaehlerInput,
  m3: number,
  from: Date | null,
  to: Date,
): number | null {
  const factors = meter.umrechnungsfaktoren ?? [];
  if (factors.length === 0) return m3 * GAS_KWH_FACTOR;
  return convertGasToKwh(m3, from, to, factors).kwh;
}

function intervalCost(
  meter: ReportZaehlerInput,
  amount: number | null,
  days: number,
  endDate: Date,
  recorded: number | null,
  startDate: Date | null = null,
): number | null {
  if (recorded != null) return recorded;
  if (amount === null || !meter.tarife || meter.tarife.length === 0) return null;
  const tarif = pickTariffForDate(meter.tarife, endDate);
  if (!tarif) return null;
  const isGas = kategorieToSparte(meter.kategorie) === "Gas";
  const verbrauch = isGas ? gasKwh(meter, amount, startDate, endDate) : amount;
  // Ohne umrechenbaren Verbrauch keine Kostenzahl.
  if (verbrauch === null) return null;
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
        sparte === "Gas" && !first.zaehlerGetauscht
          ? gasKwh(meter, first.wert, null, first.datum)
          : null,
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
      consumptionKwh:
        sparte === "Gas" && amount !== null
          ? gasKwh(meter, amount, interval.from, ending.datum)
          : null,
      days,
      cost: intervalCost(meter, amount, days, ending.datum, ending.kosten, interval.from),
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
    const cost = intervalCost(
      zaehler,
      interval.amount,
      interval.days,
      ending.datum,
      ending.kosten,
      interval.from,
    );
    return sum + (cost ?? 0);
  }, 0);

  return {
    id: zaehler.id,
    name: zaehler.name,
    sparte,
    einheit: zaehler.einheit,
    totalConsumption: stats.total,
    // Die Jahressumme ueber den GANZEN erfassten Zeitraum umrechnen — sonst
    // stimmte sie nicht mit der Summe der Zeilen ueberein, die jede fuer sich
    // faktorweise gerechnet wurde.
    totalConsumptionKwh:
      sparte === "Gas"
        ? gasKwh(
            zaehler,
            stats.total,
            ascending[0]?.datum ?? null,
            ascending[ascending.length - 1]?.datum ?? new Date(),
          )
        : null,
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
    // Jeder tatsaechlich gepflegte Faktor mit seinem Zeitraum. Die Fusszeile
    // weist sie aus — bei Gas ist die Umrechnung ein Teil der Rechnung, und wer
    // den Bericht spaeter gegen eine Jahresrechnung haelt, muss sehen koennen,
    // mit welchen Zahlen gerechnet wurde.
    gasFaktoren: zaehlerList
      .filter((zaehler) => kategorieToSparte(zaehler.kategorie) === "Gas")
      .flatMap((zaehler) => zaehler.umrechnungsfaktoren ?? [])
      .map((faktor) => ({
        von: toIsoDate(new Date(faktor.gueltigAb)),
        bis: faktor.gueltigBis ? toIsoDate(new Date(faktor.gueltigBis)) : null,
        brennwert: faktor.brennwert,
        zustandszahl: faktor.zustandszahl,
      }))
      // Doppelte entfernen: Zwei Gaszaehler koennen denselben Faktor fuehren,
      // und ihn zweimal in die Fusszeile zu schreiben verwirrt nur.
      .filter(
        (faktor, index, all) =>
          all.findIndex(
            (other) =>
              other.von === faktor.von &&
              other.bis === faktor.bis &&
              other.brennwert === faktor.brennwert &&
              other.zustandszahl === faktor.zustandszahl,
          ) === index,
      )
      .sort((a, b) => a.von.localeCompare(b.von)),
    extras,
  };
}
