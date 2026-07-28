/** Zusatzwissen ueber den Zaehler, das die reine Reihe nicht hergibt. */
export interface ConsumptionOptions {
  /**
   * Stellenzahl des Zaehlwerks, z. B. 6 fuer ein Geraet, das bei 999999
   * ueberlaeuft. `null`/undefined = unbekannt, dann wird kein Ueberlauf erkannt.
   *
   * Bewusst nicht geraten: Aus den Ablesungen allein laesst sich die Stellenzahl
   * nicht ableiten, und ein falsch geratener Ueberlauf erfindet Verbrauch, der
   * nie stattgefunden hat. Lieber ein `null`-Intervall, das jemand ansieht.
   */
  stellen?: number | null;
}

/**
 * Ab wann ein Ausgangswert "nahe am Ueberlauf" liegt.
 *
 * Ein Zaehler laeuft ueber, wenn er oben ankommt — steht er bei 12 von 999999,
 * ist ein negatives Delta alles Moegliche, nur kein Ueberlauf. 90 % laesst
 * genug Raum fuer den Fall, dass zwischen zwei Ablesungen viel verbraucht
 * wurde, und schliesst zugleich aus, dass eine Fehleingabe als Ueberlauf
 * durchgeht.
 */
const ROLLOVER_NEAR_MAX = 0.9;

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
  /**
   * Der Verbrauch wurde ueber einen Zaehlerueberlauf hinweg gerechnet.
   *
   * Die Zahl ist korrigiert und belastbar — das Kennzeichen existiert, damit
   * die Oberflaeche es sagen kann. Ein Intervall, das ploetzlich den ganzen
   * Zaehlerumfang umfasst, sieht sonst nach einem Fehler aus.
   */
  rollover: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Verbrauch je Ablesungs-Intervall aus einer Reihe von Zählerständen.
 *
 * Zählertausch: eine Ablesung mit `zaehlerGetauscht` hält in `wert` den
 * **Endstand des ALTEN** Zählers und in `startwertNeu` den **Anfangsstand des
 * NEUEN** Geräts (so sind die Eingabefelder beschriftet: „Zählerstand" ist,
 * was man abliest; „Startwert neuer Zähler", wo das Ersatzgerät beginnt).
 * Daraus folgt, gegen welchen Vorwert ein Intervall rechnet:
 *
 *   … → Tausch : gegen `previous.wert`        (Verbrauch auf dem alten Gerät)
 *   Tausch → … : gegen `previous.startwertNeu` (Verbrauch auf dem neuen Gerät)
 *
 * Der Startwert gehört also zum FOLGENDEN Intervall, nicht zum Intervall, das
 * an der Tausch-Ablesung endet. Andersherum entstehen zwei Fehler auf einmal:
 * das Tausch-Intervall wird auf den kompletten Zählerstand des Altgeräts
 * aufgebläht (es rechnet Endstand − 0 statt Endstand − Vorablesung), und die
 * darauffolgende Ablesung wird gegen ebendiesen hohen Altstand gerechnet, wird
 * damit negativ und fällt als „unplausibel" (`null`) komplett aus Bericht und
 * Summen heraus.
 */
export function calculateConsumption(
  readings: ConsumptionInputReading[],
  options: ConsumptionOptions = {},
): ConsumptionInterval[] {
  // 10^stellen — der Wert, bei dem das Zaehlwerk auf 0 zurueckspringt.
  const overflow =
    options.stellen && options.stellen > 0 ? Math.pow(10, options.stellen) : null;
  const sorted = [...readings].sort((a, b) => a.datum.getTime() - b.datum.getTime());

  return sorted.slice(1).map((reading, index) => {
    const previous = sorted[index];
    // Endstand des Geräts, das WÄHREND dieses Intervalls gelaufen ist: nach
    // einem Tausch ist das der Startwert des Neugeräts, sonst schlicht der
    // vorherige Zählerstand. `?? 0` deckt den Tausch ohne erfassten Startwert
    // ab — ein neues Gerät beginnt praktisch immer bei 0.
    const baseline = previous.zaehlerGetauscht ? previous.startwertNeu ?? 0 : previous.wert;
    const rawAmount = reading.wert - baseline;

    // Ein negatives Delta hat drei moegliche Ursachen, und sie verdienen
    // unterschiedliche Antworten:
    //
    //   Zaehlertausch  — oben bereits ueber `baseline` abgefangen
    //   Ueberlauf      — korrigierbar, WENN die Stellenzahl bekannt ist und der
    //                    Ausgangswert oben am Anschlag stand
    //   Fehleingabe    — nicht korrigierbar, bleibt `null`
    //
    // Die mittlere Bedingung ist der Kern: Ohne sie wuerde jede Fehleingabe zu
    // einem erfundenen Verbrauch von fast einem ganzen Zaehlerumfang.
    const isRollover =
      rawAmount < 0 &&
      overflow !== null &&
      baseline >= overflow * ROLLOVER_NEAR_MAX &&
      baseline < overflow &&
      reading.wert >= 0 &&
      rawAmount + overflow >= 0;

    const amount = isRollover ? rawAmount + overflow : rawAmount >= 0 ? rawAmount : null;

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
      rollover: isRollover,
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
