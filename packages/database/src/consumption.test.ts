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

  it("uses startwertNeu as the baseline on a meter swap", () => {
    // New meter installed reading 5, current reading 40 → consumed 35 on the new meter.
    const intervals = calculateConsumption([
      reading("a", 0, 900),
      reading("b", 10, 40, { zaehlerGetauscht: true, startwertNeu: 5 }),
    ]);
    expect(intervals[0].amount).toBe(35);
  });

  it("treats a swap without startwertNeu as a baseline of 0", () => {
    const intervals = calculateConsumption([
      reading("a", 0, 900),
      reading("b", 10, 40, { zaehlerGetauscht: true, startwertNeu: null }),
    ]);
    expect(intervals[0].amount).toBe(40);
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
