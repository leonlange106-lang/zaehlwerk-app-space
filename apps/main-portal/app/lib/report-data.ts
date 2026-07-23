import { prisma } from "@zaehlwerk/database";
import { buildYearlyReport, type YearlyReportData } from "@/src/components/pdf/report-model";

/**
 * Lädt alle aktiven Zähler samt Ablesungen und baut daraus die
 * Jahresübersicht-Struktur für den PDF-Bericht. Ein einziges `findMany` mit
 * `include` — kein N+1.
 */
export async function getYearlyReportData(): Promise<YearlyReportData> {
  const zaehlerList = await prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: [{ kategorie: "asc" }, { sortIndex: "asc" }],
    include: { ablesungen: { orderBy: { datum: "asc" } } },
  });

  return buildYearlyReport(zaehlerList);
}
