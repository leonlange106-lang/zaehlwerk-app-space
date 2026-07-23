/**
 * Tarifbasierte Kostenberechnung — 1:1 nach der Original-Formel aus
 * Za_hler.xlsm (Blatt „Gas in kWh"):
 *   Jahreskosten = (Arbeitspreis_brutto × Verbrauch) / 100 + Grundpreis_brutto
 * mit brutto = netto × (1 + MwSt/100). Arbeitspreis in Cent je
 * Abrechnungseinheit (kWh bei Strom/Gas, m³ bei Wasser), Grundpreis in € pro Jahr.
 */

/** Browser-sichere Minimalform eines Tarifs (unabhängig vom Prisma-Typ). */
export interface TariffInput {
  gueltigAb: Date | string;
  gueltigBis: Date | string | null;
  arbeitspreisCtNetto: number;
  grundpreisJahrNetto: number;
  mwstProzent: number;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Erster Tarif, dessen Gültigkeit das Datum abdeckt (`gueltigBis` leer = offen). */
export function pickTariffForDate<T extends TariffInput>(tarife: T[], date: Date): T | null {
  const t = date.getTime();
  for (const tarif of tarife) {
    const ab = ms(tarif.gueltigAb);
    const bis = tarif.gueltigBis ? ms(tarif.gueltigBis) : Number.POSITIVE_INFINITY;
    if (t >= ab && t <= bis) return tarif;
  }
  return null;
}

/**
 * Kosten eines Intervalls aus einem Tarif. `verbrauch` in der
 * Abrechnungseinheit des Tarifs (kWh bei Strom/Gas, m³ bei Wasser), `tage` =
 * Länge des Intervalls (für die anteilige Grundpreis-Umlage übers Jahr).
 */
export function calculateTariffCost(tarif: TariffInput, verbrauch: number, tage: number): number {
  const faktor = 1 + tarif.mwstProzent / 100;
  const arbeitspreisBrutto = tarif.arbeitspreisCtNetto * faktor; // ct je Einheit
  const grundpreisBrutto = tarif.grundpreisJahrNetto * faktor; // € / Jahr
  const arbeitskosten = (arbeitspreisBrutto * verbrauch) / 100; // €
  const grundkosten = tage > 0 ? grundpreisBrutto * (tage / 365) : 0;
  return arbeitskosten + grundkosten;
}
