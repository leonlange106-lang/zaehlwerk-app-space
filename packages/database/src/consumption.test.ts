import { describe, expect, it } from "vitest";
import {
  calculateConsumption,
  computeConsumptionStats,
  sumConsumption,
  type ConsumptionInputReading,
} from "./consumption";

const DAY = 86_400_000;

function reading(
  id: string,
  offsetDays: number,
  wert: number,
  extra: Partial<ConsumptionInputReading> = {},
): ConsumptionInputReading {
  return {
    id,
    datum: new Date(Date.UTC(2024, 0, 1) + offsetDays * DAY),
    wert,
    zaehlerGetauscht: false,
    startwertNeu: null,
    ...extra,
  };
}

describe("calculateConsumption", () => {
  it("returns no intervals for fewer than two readings", () => {
    expect(calculateConsumption([])).toEqual([]);
    expect(calculateConsumption([reading("a", 0, 100)])).toEqual([]);
  });

  it("computes the difference and per-day rate for a simple interval", () => {
    const intervals = calculateConsumption([reading("a", 0, 100), reading("b", 10, 200)]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].amount).toBe(100);
    expect(intervals[0].days).toBe(10);
    expect(intervals[0].amountPerDay).toBe(10);
    expect(intervals[0].fromReadingId).toBe("a");
    expect(intervals[0].toReadingId).toBe("b");
  });

  it("sorts unsorted input by date before pairing", () => {
    const intervals = calculateConsumption([reading("b", 10, 200), reading("a", 0, 100)]);
    expect(intervals[0].fromReadingId).toBe("a");
    expect(intervals[0].toReadingId).toBe("b");
    expect(intervals[0].amount).toBe(100);
  });

  it("marks a negative difference as implausible (null), never as zero", () => {
    const intervals = calculateConsumption([reading("a", 0, 200), reading("b", 10, 150)]);
    expect(intervals[0].amount).toBeNull();
    expect(intervals[0].amountPerDay).toBeNull();
  });

  // --- Zählertausch -------------------------------------------------------
  // Eine Tausch-Ablesung hält den ENDSTAND des alten Geräts in `wert` und den
  // ANFANGSSTAND des neuen in `startwertNeu`. Der Startwert gehört damit zum
  // FOLGENDEN Intervall — beide Seiten des Tauschs werden hier geprüft, weil
  // genau diese Verwechslung den Verbrauch nach jedem Tausch verschluckt hat.

  it("rechnet das Intervall BIS zum Tausch gegen die vorherige Ablesung (altes Gerät)", () => {
    // Altgerät läuft von 1000 auf 1120 → 120 verbraucht, nicht 1120.
    const intervals = calculateConsumption([
      reading("a", 0, 1000),
      reading("b", 10, 1120, { zaehlerGetauscht: true, startwertNeu: 0 }),
    ]);
    expect(intervals[0].amount).toBe(120);
  });

  it("rechnet das Intervall NACH dem Tausch gegen startwertNeu (neues Gerät)", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 1000),
      reading("b", 10, 1120, { zaehlerGetauscht: true, startwertNeu: 5 }),
      reading("c", 20, 95),
    ]);
    expect(intervals[0].amount).toBe(120); // altes Gerät
    expect(intervals[1].amount).toBe(90); // neues Gerät: 95 − 5
  });

  it("nimmt beim Tausch ohne startwertNeu einen Anfangsstand von 0 an", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 1000),
      reading("b", 10, 1120, { zaehlerGetauscht: true, startwertNeu: null }),
      reading("c", 20, 40),
    ]);
    expect(intervals[1].amount).toBe(40);
  });

  it("verliert nach einem Tausch weder Verbrauch noch ein Intervall", () => {
    // Regression: vorher wurde das Tausch-Intervall auf 1120 aufgebläht und das
    // Folge-Intervall (40 − 1120 < 0) als unplausibel verworfen — im Bericht
    // blieb die Zeile nach jedem Zählertausch leer.
    const intervals = calculateConsumption([
      reading("a", 0, 1000),
      reading("b", 10, 1120, { zaehlerGetauscht: true, startwertNeu: 0 }),
      reading("c", 20, 40),
    ]);
    expect(intervals.map((i) => i.amount)).toEqual([120, 40]);
    expect(sumConsumption(intervals)).toBe(160);
  });

  it("behandelt zwei aufeinanderfolgende Tausche korrekt", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 1000),
      reading("b", 10, 1120, { zaehlerGetauscht: true, startwertNeu: 0 }),
      reading("c", 20, 30, { zaehlerGetauscht: true, startwertNeu: 7 }),
      reading("d", 30, 50),
    ]);
    expect(intervals.map((i) => i.amount)).toEqual([120, 30, 43]);
  });

  it("never emits negative day counts and rounds to whole calendar days", () => {
    const a = reading("a", 0, 100);
    const b: ConsumptionInputReading = {
      ...reading("b", 0, 150),
      datum: new Date(a.datum.getTime() + 2.4 * DAY),
    };
    const intervals = calculateConsumption([a, b]);
    expect(intervals[0].days).toBe(2);
    expect(intervals[0].amountPerDay).toBeCloseTo(25, 5);
  });

  it("yields amountPerDay null when two readings share the same day", () => {
    const a = reading("a", 0, 100);
    const b = { ...reading("b", 0, 130) };
    const intervals = calculateConsumption([a, b]);
    expect(intervals[0].days).toBe(0);
    expect(intervals[0].amount).toBe(30);
    expect(intervals[0].amountPerDay).toBeNull();
  });
});

describe("sumConsumption", () => {
  it("sums plausible intervals and skips implausible (null) ones", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 100),
      reading("b", 10, 200), // +100
      reading("c", 20, 150), // negative → null, skipped
      reading("d", 30, 250), // +100
    ]);
    expect(sumConsumption(intervals)).toBe(200);
  });
});

describe("computeConsumptionStats", () => {
  it("returns quantity-weighted average per day, not a naive interval mean", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 0),
      reading("b", 1, 100), // 100 over 1 day
      reading("c", 11, 200), // 100 over 10 days
    ]);
    const stats = computeConsumptionStats(intervals);
    expect(stats.total).toBe(200);
    expect(stats.totalDays).toBe(11);
    // Weighted: 200 / 11 ≈ 18.18 — a naive mean of the two rates would be 55.
    expect(stats.avgPerDay).toBeCloseTo(200 / 11, 5);
    expect(stats.maxPerDay).toBe(100);
    expect(stats.minPerDay).toBe(10);
    expect(stats.intervalCount).toBe(2);
    expect(stats.hasImplausibleIntervals).toBe(false);
  });

  it("flags implausible intervals and excludes them from the count", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 100),
      reading("b", 10, 50), // negative → null
      reading("c", 20, 150),
    ]);
    const stats = computeConsumptionStats(intervals);
    expect(stats.hasImplausibleIntervals).toBe(true);
    expect(stats.intervalCount).toBe(1);
  });

  it("handles an empty interval list without dividing by zero", () => {
    const stats = computeConsumptionStats([]);
    expect(stats.total).toBe(0);
    expect(stats.totalDays).toBe(0);
    expect(stats.avgPerDay).toBeNull();
    expect(stats.maxPerDay).toBeNull();
    expect(stats.minPerDay).toBeNull();
  });
});

// Zaehlerueberlauf: Ein 6-stelliges Werk springt von 999999 auf 0. Ohne
// Behandlung faellt das Intervall als "unplausibel" aus jeder Summe heraus —
// der Verbrauch eines ganzen Zeitraums verschwindet stillschweigend.
describe("calculateConsumption — Ueberlauf", () => {
  const r = (id: string, tag: number, wert: number) => ({
    id,
    datum: new Date(Date.UTC(2026, 0, tag)),
    wert,
    zaehlerGetauscht: false,
    startwertNeu: null,
  });

  it("faellt ohne bekannte Stellenzahl auf 'unplausibel' zurueck", () => {
    // Aus den Ablesungen allein laesst sich die Stellenzahl nicht ableiten. Sie
    // zu raten hiesse, Verbrauch zu erfinden, der nie stattgefunden hat.
    const [interval] = calculateConsumption([r("a", 1, 999_950), r("b", 2, 30)]);
    expect(interval.amount).toBeNull();
    expect(interval.rollover).toBe(false);
  });

  it("rechnet ueber den Ueberlauf hinweg, wenn die Stellenzahl bekannt ist", () => {
    const [interval] = calculateConsumption([r("a", 1, 999_950), r("b", 2, 30)], {
      stellen: 6,
    });
    // 999950 → 999999 (49) → 0 → 30  ⇒  80
    expect(interval.amount).toBe(80);
    expect(interval.rollover).toBe(true);
  });

  it("korrigiert NICHT, wenn der Ausgangswert weit unter dem Anschlag lag", () => {
    // Der eigentliche Schutz: Ohne diese Bedingung wuerde jede Fehleingabe zu
    // einem erfundenen Verbrauch von fast einem ganzen Zaehlerumfang.
    const [interval] = calculateConsumption([r("a", 1, 5_000), r("b", 2, 4_000)], {
      stellen: 6,
    });
    expect(interval.amount).toBeNull();
    expect(interval.rollover).toBe(false);
  });

  it("laesst gewoehnliche Intervalle unberuehrt", () => {
    const [interval] = calculateConsumption([r("a", 1, 1_000), r("b", 2, 1_050)], {
      stellen: 6,
    });
    expect(interval.amount).toBe(50);
    expect(interval.rollover).toBe(false);
  });

  it("zaehlt einen korrigierten Ueberlauf in die Summe", () => {
    // Der Sinn der ganzen Uebung: Vorher fiel dieser Zeitraum aus jeder
    // Auswertung heraus, weil `null` uebersprungen wird.
    const intervals = calculateConsumption(
      [r("a", 1, 999_950), r("b", 2, 30), r("c", 3, 60)],
      { stellen: 6 },
    );
    expect(sumConsumption(intervals)).toBe(110);
  });
});
