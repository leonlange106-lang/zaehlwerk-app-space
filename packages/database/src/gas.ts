// Gas m³ → kWh = Verbrauch × Brennwert × Zustandszahl.
//
// Beide Faktoren stehen auf jeder Jahresrechnung und ÄNDERN SICH — der
// Brennwert sogar monatlich. Bis hierher rechnete Zählwerk mit zwei festen
// Zahlen aus dem Original-Projekt (Stand 2021), und je weiter das zurückliegt,
// desto weiter liegt die Kostenrechnung daneben. An einer Gasrechnung ist das
// kein Rundungsfehler, sondern zweistellige Prozente.
//
// Seit ZW-02 sind die Faktoren je Zähler und Zeitraum pflegbar. Die alten
// Konstanten bleiben als NOTNAGEL bestehen, nicht als Standard — siehe unten.

/**
 * Die Faktoren aus dem Original-Projekt (Za_hler.xlsm, Stand 2021+).
 *
 * NUR noch Notnagel und Startwert der Migration. Wer sie zum Rechnen benutzt,
 * rechnet mit dem Gasjahr 2021 — deshalb steht an jeder verbliebenen
 * Verwendung dabei, dass das Ergebnis auf einer Annahme beruht.
 */
export const GAS_BRENNWERT = 10.312; // kWh/m³
export const GAS_ZUSTANDSZAHL = 0.9622;
export const GAS_KWH_FACTOR = GAS_BRENNWERT * GAS_ZUSTANDSZAHL; // ≈ 9,922

/**
 * Umrechnung mit dem festen Faktor von 2021.
 *
 * @deprecated Für alles, was einen Zeitraum kennt, `convertGasToKwh` benutzen.
 * Diese Fassung weiß nicht, WANN verbraucht wurde, und kann deshalb den
 * richtigen Brennwert gar nicht kennen.
 */
export function gasM3ToKwh(m3: number): number {
  return m3 * GAS_KWH_FACTOR;
}

/** Ein gepflegter Umrechnungsfaktor mit Gültigkeitszeitraum. */
export interface GasFactorInput {
  gueltigAb: Date | string;
  gueltigBis?: Date | string | null;
  brennwert: number;
  zustandszahl: number;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

const MS_PER_DAY = 86_400_000;

/** Der Faktor selbst — Brennwert × Zustandszahl. */
export function gasFactorValue(factor: GasFactorInput): number {
  return factor.brennwert * factor.zustandszahl;
}

/** Der zu einem Zeitpunkt gültige Faktor, oder null. */
export function pickGasFactorForDate<T extends GasFactorInput>(factors: T[], date: Date): T | null {
  const t = date.getTime();
  for (const factor of factors) {
    const ab = ms(factor.gueltigAb);
    const bis = factor.gueltigBis ? ms(factor.gueltigBis) : Number.POSITIVE_INFINITY;
    if (t >= ab && t <= bis) return factor;
  }
  return null;
}

/** Ein Abschnitt des Intervalls, der unter EINEM Faktor lag. */
export interface GasConversionSegment {
  from: Date;
  to: Date;
  days: number;
  /** Anteil des Intervalls, der auf diesen Abschnitt entfällt (0…1). */
  share: number;
  brennwert: number;
  zustandszahl: number;
  /** Die kWh dieses Abschnitts. */
  kwh: number;
}

export interface GasConversionResult {
  /**
   * Die umgerechnete Menge — oder `null`, wenn für einen Teil des Zeitraums
   * kein Faktor gepflegt ist.
   *
   * Bewusst `null` und nicht „mit dem Nachbarwert gerechnet": Ein geschätzter
   * Brennwert sieht aus wie ein abgelesener, und niemand merkt je, dass die
   * Gasrechnung auf einer Annahme beruht. Eine Lücke, die man sieht, ist
   * besser als eine Zahl, der man glaubt.
   */
  kwh: number | null;
  /** Alle Faktoren des Zeitraums waren gepflegt. */
  complete: boolean;
  /** Anteil des Zeitraums, der von einem Faktor gedeckt war (0…1). */
  coverage: number;
  /** Die Abschnitte — für „welcher Faktor galt wann", z. B. im PDF-Bericht. */
  segments: GasConversionSegment[];
}

/**
 * Verbrauch in m³ über einen Zeitraum in kWh umrechnen — faktorweise.
 *
 * Ändert sich der Brennwert mitten im Intervall (im Winter jeden Monat), wird
 * der Verbrauch ANTEILIG NACH TAGEN auf die Abschnitte verteilt. Das ist eine
 * Annahme, und zwar eine bewusste: Wie sich die Kubikmeter tatsächlich über die
 * Wochen verteilt haben, sagt kein Zählerstand — dazwischen wurde ja nicht
 * abgelesen. Nach Tagen zu teilen kommt ohne weitere Erfindung aus und ist
 * genau das, was ein Versorger auf der Jahresrechnung ebenfalls tut.
 *
 * Ohne `from` (die allererste Ablesung eines Zählers hat kein Vorintervall)
 * zählt der Faktor am Endzeitpunkt.
 */
export function convertGasToKwh(
  m3: number,
  from: Date | null,
  to: Date,
  factors: GasFactorInput[],
): GasConversionResult {
  // Punktförmiger Zeitraum: ein Faktor, kein Aufteilen.
  if (!from || from.getTime() >= to.getTime()) {
    const factor = pickGasFactorForDate(factors, to);
    if (!factor) return { kwh: null, complete: false, coverage: 0, segments: [] };
    const value = gasFactorValue(factor);
    return {
      kwh: m3 * value,
      complete: true,
      coverage: 1,
      segments: [
        {
          from: to,
          to,
          days: 0,
          share: 1,
          brennwert: factor.brennwert,
          zustandszahl: factor.zustandszahl,
          kwh: m3 * value,
        },
      ],
    };
  }

  // Die Grenzen, an denen sich etwas ändern KANN: Anfang und Ende des
  // Intervalls plus jeder Faktorwechsel dazwischen. Danach liegt jeder
  // Abschnitt garantiert unter genau einem Faktor — oder unter keinem.
  const start = from.getTime();
  const end = to.getTime();
  const cuts = new Set<number>([start, end]);
  for (const factor of factors) {
    const ab = ms(factor.gueltigAb);
    if (ab > start && ab < end) cuts.add(ab);
    if (factor.gueltigBis) {
      // `gueltigBis` ist EINSCHLIESSLICH — der Wechsel liegt eine Millisekunde
      // danach. Ohne das +1 fiele der letzte Augenblick des alten Zeitraums in
      // den neuen Abschnitt.
      const bis = ms(factor.gueltigBis) + 1;
      if (bis > start && bis < end) cuts.add(bis);
    }
  }

  const bounds = [...cuts].sort((a, b) => a - b);
  const totalMs = end - start;

  const segments: GasConversionSegment[] = [];
  let coveredMs = 0;
  let kwh = 0;
  let complete = true;

  for (let index = 0; index < bounds.length - 1; index += 1) {
    const segStart = bounds[index]!;
    const segEnd = bounds[index + 1]!;
    const segMs = segEnd - segStart;
    if (segMs <= 0) continue;

    const share = segMs / totalMs;
    // In der MITTE des Abschnitts nachsehen. An seinem Rand liegt gerade der
    // Wechsel, und je nach Rundung erwischte man den falschen der beiden.
    const factor = pickGasFactorForDate(factors, new Date(segStart + segMs / 2));

    if (!factor) {
      complete = false;
      continue;
    }

    const value = gasFactorValue(factor);
    const segKwh = m3 * share * value;
    kwh += segKwh;
    coveredMs += segMs;
    segments.push({
      from: new Date(segStart),
      to: new Date(segEnd),
      days: Math.round(segMs / MS_PER_DAY),
      share,
      brennwert: factor.brennwert,
      zustandszahl: factor.zustandszahl,
      kwh: segKwh,
    });
  }

  return {
    // Siehe `kwh` oben: lieber eine sichtbare Lücke als eine Zahl, der man glaubt.
    kwh: complete ? kwh : null,
    complete,
    coverage: totalMs > 0 ? coveredMs / totalMs : 0,
    segments,
  };
}

/** Ein Faktor mit Id — für die Überlappungsprüfung beim Bearbeiten. */
export interface IdentifiedGasFactor extends GasFactorInput {
  id?: string;
}

/**
 * Überschneidet sich ein Zeitraum mit einem bereits gepflegten?
 *
 * Zwei gültige Faktoren zur selben Zeit heißt: `pickGasFactorForDate` nimmt den
 * erstbesten, und welcher das ist, hängt an der Sortierung der Abfrage. Die
 * Kostenrechnung änderte sich dann still, sobald jemand einen dritten Faktor
 * anlegt und die Reihenfolge sich verschiebt.
 *
 * `ignoreId` ist fürs Bearbeiten: Ein Faktor überschneidet sich immer mit sich
 * selbst.
 */
export function findOverlappingGasFactor<T extends IdentifiedGasFactor>(
  existing: T[],
  // Nur der ZEITRAUM, nicht der ganze Faktor: Ob sich zwei ueberschneiden,
  // haengt an nichts anderem. Brennwert und Zustandszahl hier zu verlangen
  // zwaenge jeden Aufrufer, sie mitzuschleppen, nur um die Signatur zu fuellen.
  candidate: { gueltigAb: Date | string; gueltigBis?: Date | string | null },
  ignoreId?: string,
): T | null {
  const ab = ms(candidate.gueltigAb);
  const bis = candidate.gueltigBis ? ms(candidate.gueltigBis) : Number.POSITIVE_INFINITY;

  for (const factor of existing) {
    if (ignoreId && factor.id === ignoreId) continue;
    const otherAb = ms(factor.gueltigAb);
    const otherBis = factor.gueltigBis ? ms(factor.gueltigBis) : Number.POSITIVE_INFINITY;
    if (ab <= otherBis && otherAb <= bis) return factor;
  }
  return null;
}
