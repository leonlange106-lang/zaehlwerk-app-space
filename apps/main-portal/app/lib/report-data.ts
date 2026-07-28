import { consumptionReadings, prisma } from "@zaehlwerk/database";
import { buildYearlyReport, type ReportZaehlerInput, type YearlyReportData } from "@/src/components/pdf/report-model";

export interface ReportOptions {
  /** Nur Ablesungen dieses Kalenderjahres (plus Basiswert davor) berücksichtigen. */
  year?: number;
  /** Auf diese Zähler-Ids einschränken (leer/undefined = alle aktiven). */
  ids?: string[];
}

/**
 * Lädt aktive Zähler samt Ablesungen und Tarifen und baut daraus die
 * Jahresübersicht-Struktur für den PDF-Bericht. Optional gefiltert nach Jahr
 * und Zähler-Auswahl. Ein einziges `findMany` mit `include` — kein N+1.
 */
export async function getYearlyReportData(options: ReportOptions = {}): Promise<YearlyReportData> {
  const zaehlerList = await prisma.zaehler.findMany({
    where: {
      aktiv: true,
      ...(options.ids && options.ids.length > 0 ? { id: { in: options.ids } } : {}),
    },
    orderBy: [{ kategorie: "asc" }, { sortIndex: "asc" }],
    include: {
      ablesungen: { orderBy: { datum: "asc" } },
      tarife: { orderBy: { gueltigAb: "asc" } },
      register: { orderBy: { sortIndex: "asc" } },
      umrechnungsfaktoren: { orderBy: { gueltigAb: "asc" } },
    },
  });

  // Die Einspeisung bleibt draußen — hier, an der Grenze, nicht im Berichtsmodell.
  //
  // Die Jahresübersicht ist ein Raster aus Verbrauch, Tagen und Kosten je Sparte;
  // eine Spalte für Eingespeistes gibt es darin nicht. Ließe man die Stände
  // trotzdem durch, liefen sie in dieselbe Reihe wie der Bezug: Jedes zweite
  // Intervall käme negativ heraus, das darauffolgende spränge über den ganzen
  // Zählerstand, und der Basiswert für den Jahresanfang wäre womöglich ein
  // Einspeisestand. In einem PDF, das jemand zur Abrechnung nimmt, sind das
  // teure Zahlen.
  const prepared: ReportZaehlerInput[] = zaehlerList.map((zaehler) => ({
    ...zaehler,
    ablesungen: filterReadingsForYear(
      consumptionReadings(zaehler.register, zaehler.ablesungen),
      options.year,
    ),
  }));

  return buildYearlyReport(prepared);
}

/**
 * Beschränkt Ablesungen auf ein Jahr, behält aber die letzte Ablesung DAVOR als
 * Basiswert, damit das erste Intervall des Jahres korrekt berechnet wird.
 */
function filterReadingsForYear<T extends { datum: Date }>(readings: T[], year?: number): T[] {
  if (!year) return readings;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const within = readings.filter((r) => r.datum >= yearStart && r.datum < yearEnd);
  const baseline = readings.filter((r) => r.datum < yearStart).at(-1);
  return baseline ? [baseline, ...within] : within;
}
