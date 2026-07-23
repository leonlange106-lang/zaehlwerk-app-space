export interface ConsumptionInputReading {
  id: string;
  datum: Date;
  wert: number;
  zaehlerGetauscht: boolean;
  startwertNeu: number | null;
}

export interface ConsumptionInterval {
  fromReadingId: string | null;
  toReadingId: string;
  from: Date | null;
  to: Date;
  /** Kalendertage zwischen den beiden Ablesungen (gerundet, nie negativ). */
  days: number;
  /**
   * Verbrauch im Intervall. `null` bedeutet **nicht plausibel** (z. B.
   * negativer Differenzwert durch Fehleingabe oder Zählertausch ohne
   * Startwert) und wird bewusst NICHT als 0 gewertet — sonst würde ein
   * Scheinwert von 0 jeden Durchschnitt nach unten ziehen und den Datenfehler
   * verstecken. Analog zur `None`-Behandlung in `logic.py` des Referenzprojekts.
   */
  amount: number | null;
  /** Verbrauch pro Tag (`amount / days`); `null`, wenn `amount` null oder `days` 0. */
  amountPerDay: number | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Verbrauch je Ablesungs-Intervall aus einer Reihe von Zählerständen.
 * Bei einem Zählertausch (`zaehlerGetauscht`) wird nicht gegen die vorherige
 * Ablesung (altes Gerät) gerechnet, sondern gegen `startwertNeu` des neuen
 * Zählers — analog zu `meter_replaced` / `meter_start` im Referenzprojekt.
 */
export function calculateConsumption(
  readings: ConsumptionInputReading[],
): ConsumptionInterval[] {
  const sorted = [...readings].sort((a, b) => a.datum.getTime() - b.datum.getTime());

  return sorted.slice(1).map((reading, index) => {
    const previous = sorted[index];
    const baseline = reading.zaehlerGetauscht ? reading.startwertNeu ?? 0 : previous.wert;
    const rawAmount = reading.wert - baseline;
    // Negativer Verbrauch = Datenfehler (Zählerüberlauf, Fehleingabe, Tausch
    // ohne Startwert). Als `null` markieren statt auf 0 zu klemmen.
    const amount = rawAmount >= 0 ? rawAmount : null;

    const days = Math.max(
      0,
      Math.round((reading.datum.getTime() - previous.datum.getTime()) / MS_PER_DAY),
    );
    const amountPerDay = amount !== null && days > 0 ? amount / days : null;

    return {
      fromReadingId: previous.id,
      toReadingId: reading.id,
      from: previous.datum,
      to: reading.datum,
      days,
      amount,
      amountPerDay,
    };
  });
}

/** Summe aller plausiblen Intervall-Verbräuche (unplausible = `null` werden übersprungen). */
export function sumConsumption(intervals: ConsumptionInterval[]): number {
  return intervals.reduce((total, interval) => total + (interval.amount ?? 0), 0);
}

export interface ConsumptionStats {
  /** Summe aller plausiblen Intervall-Verbräuche. */
  total: number;
  /** Gesamter abgedeckter Zeitraum in Tagen (voller Spann, inkl. unplausibler Intervalle). */
  totalDays: number;
  /** Mengengewichteter Verbrauch pro Tag (`total / totalDays`). */
  avgPerDay: number | null;
  /** Höchster/niedrigster Pro-Tag-Verbrauch über alle plausiblen Intervalle. */
  maxPerDay: number | null;
  minPerDay: number | null;
  /** Anzahl plausibler Intervalle, die in `total` eingeflossen sind. */
  intervalCount: number;
  /** `true`, wenn mindestens ein Intervall wegen unplausibler Daten übersprungen wurde. */
  hasImplausibleIntervals: boolean;
}

/**
 * Verdichtet eine Intervall-Reihe zu Kennzahlen. `avgPerDay` ist bewusst
 * mengengewichtet (`total / totalDays`) statt ein einfacher Mittelwert über
 * die Intervalle — Letzterer würde kurze und lange Intervalle gleich
 * gewichten und den Schnitt verzerren (siehe `compute_stats` in der Referenz).
 */
export function computeConsumptionStats(intervals: ConsumptionInterval[]): ConsumptionStats {
  const total = sumConsumption(intervals);
  // Da die Intervalle lückenlos aneinander anschließen, ist die Summe ihrer
  // Tage exakt der volle Zeitraum (letzte minus erste Ablesung).
  const totalDays = intervals.reduce((sum, interval) => sum + interval.days, 0);
  const perDayValues = intervals
    .map((interval) => interval.amountPerDay)
    .filter((value): value is number => value !== null);

  return {
    total,
    totalDays,
    avgPerDay: totalDays > 0 ? total / totalDays : null,
    maxPerDay: perDayValues.length > 0 ? Math.max(...perDayValues) : null,
    minPerDay: perDayValues.length > 0 ? Math.min(...perDayValues) : null,
    intervalCount: intervals.filter((interval) => interval.amount !== null).length,
    hasImplausibleIntervals: intervals.some((interval) => interval.amount === null),
  };
}
