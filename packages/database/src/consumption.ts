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
  amount: number;
}

/**
 * Verbrauch je Ablesungs-Intervall aus einer Reihe von Zählerständen.
 * Bei einem Zählertausch (`zaehlerGetauscht`) wird nicht gegen die vorherige
 * Ablesung (altes Gerät) gerechnet, sondern gegen `startwertNeu` des neuen
 * Zählers — analog zur Logik im Referenzprojekt (`meter_replaced` / `meter_start`).
 */
export function calculateConsumption(
  readings: ConsumptionInputReading[],
): ConsumptionInterval[] {
  const sorted = [...readings].sort((a, b) => a.datum.getTime() - b.datum.getTime());

  return sorted.slice(1).map((reading, index) => {
    const previous = sorted[index];
    const baseline = reading.zaehlerGetauscht ? reading.startwertNeu ?? 0 : previous.wert;

    return {
      fromReadingId: previous.id,
      toReadingId: reading.id,
      from: previous.datum,
      to: reading.datum,
      amount: Math.max(0, reading.wert - baseline),
    };
  });
}

/** Summe aller Intervall-Verbräuche (z.B. für eine Dashboard-Kachel). */
export function sumConsumption(intervals: ConsumptionInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.amount, 0);
}
