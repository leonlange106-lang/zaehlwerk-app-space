import { describe, expect, it } from "vitest";
import { projectAnnualConsumption } from "./projection";
import type { ConsumptionInputReading } from "./consumption";

function r(dateISO: string, wert: number): ConsumptionInputReading {
  return { id: dateISO, datum: new Date(dateISO), wert, zaehlerGetauscht: false, startwertNeu: null };
}

describe("projectAnnualConsumption — linear method", () => {
  it("extrapolates a full-year estimate from partial-year data", () => {
    const now = new Date("2024-07-01T00:00:00Z"); // 182 days into a 366-day year
    const result = projectAnnualConsumption({
      readings: [r("2024-01-01T00:00:00Z", 0), r("2024-07-01T00:00:00Z", 100)],
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now,
    });

    expect(result.method).toBe("linear");
    expect(result.year).toBe(2024);
    expect(result.ytdConsumption).toBeCloseTo(100, 5);
    expect(result.coveredDays).toBeCloseTo(182, 0);
    // 100 units over 182 days → ~201 over the full 366-day year.
    expect(result.projectedAnnual).toBeCloseTo((100 * 366) / 182, 3);
    expect(result.projectedAnnual!).toBeGreaterThan(result.ytdConsumption);
    expect(result.confidence).toBe("high");
  });
});

describe("projectAnnualConsumption — insufficient data (edge cases)", () => {
  it("returns null projection with low confidence for a single reading", () => {
    const result = projectAnnualConsumption({
      readings: [r("2024-03-01T00:00:00Z", 500)],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2024-07-01T00:00:00Z"),
    });
    expect(result.projectedAnnual).toBeNull();
    expect(result.previousYearConsumption).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.deltaConsumptionPct).toBeNull();
  });

  it("returns null projection for no readings at all", () => {
    const result = projectAnnualConsumption({
      readings: [],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2024-07-01T00:00:00Z"),
    });
    expect(result.projectedAnnual).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("reports low confidence when very little of the year has elapsed", () => {
    const result = projectAnnualConsumption({
      readings: [r("2024-01-01T00:00:00Z", 0), r("2024-01-05T00:00:00Z", 20)],
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now: new Date("2024-01-06T00:00:00Z"), // ~1.4% of the year, <14 covered days
    });
    expect(result.confidence).toBe("low");
  });
});

describe("projectAnnualConsumption — year boundary", () => {
  it("splits an interval that spans New Year between the two years", () => {
    // 62 units consumed evenly across 61 days: 2023-12-01 → 2024-01-31.
    const readings = [r("2023-12-01T00:00:00Z", 0), r("2024-01-31T00:00:00Z", 62)];
    const result = projectAnnualConsumption({
      readings,
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now: new Date("2024-02-01T00:00:00Z"),
    });

    // Only the January share (30/61 of 62 ≈ 30.5) lands in the current year …
    expect(result.ytdConsumption).toBeCloseTo((62 * 30) / 61, 1);
    // … and only the December share (31/61 ≈ 31.5) counts toward last year.
    expect(result.previousYearConsumption).toBeCloseTo((62 * 31) / 61, 1);
    // Neither window sees the full 62 — proving the split rather than double-counting.
    expect(result.ytdConsumption).toBeLessThan(62);
    expect(result.previousYearConsumption!).toBeLessThan(62);
  });
});

describe("projectAnnualConsumption — seasonal weighting & deltas", () => {
  it("auto-selects the seasonal method for GAS and weights winter data down", () => {
    // Same winter-only data projected both ways: the seasonal profile must not
    // naively scale heavy January usage across the whole year like linear does.
    const readings = [r("2024-01-01T00:00:00Z", 0), r("2024-02-01T00:00:00Z", 310)];
    const now = new Date("2024-02-01T00:00:00Z");

    const seasonal = projectAnnualConsumption({ readings, kategorie: "GAS", einheit: "m³", now });
    const linear = projectAnnualConsumption({
      readings,
      kategorie: "GAS",
      einheit: "m³",
      method: "linear",
      now,
    });

    expect(seasonal.method).toBe("seasonal");
    expect(linear.method).toBe("linear");
    expect(seasonal.projectedAnnual).not.toBeNull();
    // Winter is above-average in the profile, so the seasonal annual estimate is
    // lower than the linear one that assumes every month looks like January.
    expect(seasonal.projectedAnnual!).toBeLessThan(linear.projectedAnnual!);
  });

  it("computes the year-over-year delta percentage when both years have data", () => {
    const readings = [
      r("2023-01-01T00:00:00Z", 0),
      r("2023-12-31T00:00:00Z", 1000), // last full year ≈ 1000
      r("2024-07-01T00:00:00Z", 1600), // ~600 over ~183 days → ~1200/yr projected
    ];
    const result = projectAnnualConsumption({
      readings,
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now: new Date("2024-07-01T00:00:00Z"),
    });

    // ≈1000: the full 2023 interval, plus a one-day sliver of the interval that
    // continues into 2024 (proportional split at the year boundary).
    expect(result.previousYearConsumption!).toBeGreaterThan(1000);
    expect(result.previousYearConsumption!).toBeLessThan(1010);
    expect(result.projectedAnnual).not.toBeNull();
    expect(result.deltaConsumptionPct).not.toBeNull();
    // Projected clearly above last year → positive delta.
    expect(result.deltaConsumptionPct!).toBeGreaterThan(0);
  });
});
