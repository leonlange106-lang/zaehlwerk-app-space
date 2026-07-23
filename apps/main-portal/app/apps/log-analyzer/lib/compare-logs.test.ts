import { describe, expect, it } from "vitest";
import { buildOverlay, compareLogs } from "./compare-logs";
import { makeLog, verifiedPullColumns } from "./test-helpers";

// SYNTHETIC fixtures only.

describe("compareLogs — key-metric deltas", () => {
  const a = makeLog(verifiedPullColumns());
  // Log B: higher boost, hotter IAT, a knock event, same RPM ceiling.
  const bCols = verifiedPullColumns();
  const actualB = bCols.find((c) => c.label === "Boost Actual")!;
  actualB.values = actualB.values.map((v) => (v as number) + 3);
  bCols.push({ label: "IAT", unit: "°C", values: new Array(60).fill(55) });
  const corrB = bCols.find((c) => c.label === "Ignition Correction")!;
  corrB.values = corrB.values.map((_, i) => (i === 30 ? -4 : 0));
  const aWithIat = verifiedPullColumns();
  aWithIat.push({ label: "IAT", unit: "°C", values: new Array(60).fill(40) });
  const b = makeLog(bCols);
  const aFull = makeLog(aWithIat);

  it("computes a positive peak-boost delta (B richer than A)", () => {
    const { metrics } = compareLogs(aFull, b);
    const boost = metrics.find((m) => m.key === "peakBoost")!;
    expect(boost.a).not.toBeNull();
    expect(boost.b).not.toBeNull();
    expect(boost.delta).toBeCloseTo(3, 1);
  });

  it("computes an IAT delta between the two logs", () => {
    const { metrics } = compareLogs(aFull, b);
    const iat = metrics.find((m) => m.key === "maxIat")!;
    expect(iat.a).toBe(40);
    expect(iat.b).toBe(55);
    expect(iat.delta).toBe(15);
  });

  it("captures the worst timing correction on each side", () => {
    const { metrics } = compareLogs(aFull, b);
    const corr = metrics.find((m) => m.key === "worstCorrection")!;
    expect(corr.a).toBe(0);
    expect(corr.b).toBe(-4);
    expect(corr.delta).toBe(-4);
  });

  it("returns null deltas when a metric is absent on one side", () => {
    const noIat = makeLog(verifiedPullColumns()); // no IAT channel
    const { metrics } = compareLogs(noIat, b);
    const iat = metrics.find((m) => m.key === "maxIat")!;
    expect(iat.a).toBeNull();
    expect(iat.delta).toBeNull();
  });

  it("always returns the four headline metrics", () => {
    const { metrics } = compareLogs(a, b);
    expect(metrics.map((m) => m.key)).toEqual(["peakBoost", "worstCorrection", "maxIat", "maxRpm"]);
  });
});

describe("buildOverlay — RPM-aligned resampling", () => {
  it("resamples both logs onto a shared RPM grid", () => {
    const a = makeLog(verifiedPullColumns());
    const b = makeLog(verifiedPullColumns());
    const overlay = buildOverlay(a, b, "boostActual", 50);
    expect(overlay.xLabel).toBe("RPM");
    expect(overlay.unit).toBe("psi");
    expect(overlay.points.length).toBe(50);
    // X is monotonically increasing.
    for (let i = 1; i < overlay.points.length; i += 1) {
      expect(overlay.points[i].x).toBeGreaterThanOrEqual(overlay.points[i - 1].x);
    }
    // Both traces are populated across the shared range.
    const mid = overlay.points[25];
    expect(mid.a).not.toBeNull();
    expect(mid.b).not.toBeNull();
  });

  it("interpolates identical logs to (near-)identical traces", () => {
    const a = makeLog(verifiedPullColumns());
    const overlay = buildOverlay(a, makeLog(verifiedPullColumns()), "boostActual", 40);
    for (const p of overlay.points) {
      if (p.a !== null && p.b !== null) {
        expect(Math.abs(p.a - p.b)).toBeLessThan(1e-6);
      }
    }
  });

  it("yields null on the side whose RPM range does not cover a grid point", () => {
    // A spans 1000–7000; B only 4000–7000. Low grid points miss B.
    const a = makeLog(verifiedPullColumns());
    const bRpm = Array.from({ length: 60 }, (_, i) => 4000 + Math.round((i / 59) * 3000));
    const b = makeLog(verifiedPullColumns({ rpm: bRpm }));
    const overlay = buildOverlay(a, b, "boostActual", 60);
    expect(overlay.points[0].a).not.toBeNull();
    expect(overlay.points[0].b).toBeNull();
    expect(overlay.points[overlay.points.length - 1].b).not.toBeNull();
  });

  it("returns an empty overlay when the channel is missing from both logs", () => {
    const a = makeLog(verifiedPullColumns().filter((c) => !/iat/i.test(c.label)));
    const overlay = buildOverlay(a, a, "iat", 30);
    expect(overlay.points).toHaveLength(0);
  });
});
