import { describe, expect, it } from "vitest";
import { buildOverlay, compareLogs, OVERLAY_CHANNELS, type OverlayChannel } from "./compare-logs";
import { parseLog } from "./log-parser";
import { makeSampleCsv } from "./sample-log";
import { makeLog, verifiedPullColumns, type ColumnSpec } from "./test-helpers";

// SYNTHETIC fixtures only.

/** 10 Hz time axis so the seconds-based metrics (spool-up) are meaningful. */
function seconds(n = 60): number[] {
  return Array.from({ length: n }, (_, i) => +(i * 0.1).toFixed(3));
}

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

  it("always returns the headline metric set, in order", () => {
    const { metrics } = compareLogs(a, b);
    expect(metrics.map((m) => m.key)).toEqual([
      "peakBoost",
      "spoolTime",
      "spoolRpm",
      "worstCorrection",
      "avgCorrection",
      "maxIat",
      "iatRamp",
      "maxRpm",
    ]);
  });

  it("exposes each side's WOT anchor alongside the metrics", () => {
    const { alignment } = compareLogs(aFull, b);
    // verifiedPullColumns holds pedal below WOT for the first three samples.
    expect(alignment.a.startIndex).toBe(3);
    expect(alignment.a.pedalDriven).toBe(true);
  });
});

describe("compareLogs — spool-up delta", () => {
  it("reports an earlier spool (less time, lower RPM) for the stronger log", () => {
    const base = makeLog(verifiedPullColumns(), seconds());
    // A tune that builds the same commanded boost 3 psi sooner.
    const fastCols = verifiedPullColumns();
    const act = fastCols.find((c) => c.label === "Boost Actual")!;
    act.values = act.values.map((v) => (v as number) + 3);
    const fast = makeLog(fastCols, seconds());

    const { metrics } = compareLogs(base, fast);
    const time = metrics.find((m) => m.key === "spoolTime")!;
    const rpm = metrics.find((m) => m.key === "spoolRpm")!;

    expect(time.a).not.toBeNull();
    expect(time.b).not.toBeNull();
    expect(time.delta).toBeLessThan(0); // B reaches target boost earlier
    expect(rpm.delta).toBeLessThan(0); // …and at a lower engine speed
    expect(time.unit).toBe("s");
  });

  it("measures spool time from the WOT anchor, not the start of the recording", () => {
    // Identical pull, but the second recording idles for 2 s beforehand.
    const cols = verifiedPullColumns();
    const withLeadIn: ColumnSpec[] = cols.map((c) => ({
      ...c,
      values: [...new Array(20).fill(c.label === "Pedal" ? 0 : c.values[0]), ...c.values],
    }));
    const plain = makeLog(cols, seconds());
    const delayed = makeLog(withLeadIn, seconds(80));

    const { metrics } = compareLogs(plain, delayed);
    const time = metrics.find((m) => m.key === "spoolTime")!;
    // Both spool equally fast once at WOT — the 2 s lead-in must not count.
    expect(time.delta).toBeCloseTo(0, 6);
  });

  it("yields a null spool time on a log without a real seconds axis", () => {
    const indexed = makeLog(verifiedPullColumns()); // timeUnit "#"
    const { metrics } = compareLogs(indexed, indexed);
    expect(metrics.find((m) => m.key === "spoolTime")!.a).toBeNull();
    // The RPM-based spool point is still available.
    expect(metrics.find((m) => m.key === "spoolRpm")!.a).not.toBeNull();
  });
});

describe("compareLogs — IAT ramp & timing severity", () => {
  it("measures the IAT ramp across the pull, not its absolute peak", () => {
    const cool = verifiedPullColumns();
    cool.push({ label: "IAT", unit: "°C", values: Array.from({ length: 60 }, () => 30) });
    // Heat-soaked: starts hotter AND climbs 20° over the pull.
    const hot = verifiedPullColumns();
    hot.push({
      label: "IAT",
      unit: "°C",
      values: Array.from({ length: 60 }, (_, i) => 45 + Math.round((i / 59) * 20)),
    });

    const { metrics } = compareLogs(makeLog(cool), makeLog(hot));
    const ramp = metrics.find((m) => m.key === "iatRamp")!;
    expect(ramp.a).toBe(0);
    // Ramp is measured over the pull window (starts at sample 3), so slightly
    // under the full-log 20° spread.
    expect(ramp.b).toBeGreaterThan(15);
    expect(ramp.delta).toBe(ramp.b! - ramp.a!);
  });

  it("averages the per-sample worst correction across cylinders", () => {
    const clean = verifiedPullColumns();
    const knocky = verifiedPullColumns();
    // Two cylinders, each pulling on alternating samples.
    knocky.find((c) => c.label === "Ignition Correction")!.values = Array.from(
      { length: 60 },
      (_, i) => (i % 2 === 0 ? -2 : 0),
    );
    knocky.push({
      label: "Ignition Correction Cyl 2",
      unit: "°",
      values: Array.from({ length: 60 }, (_, i) => (i % 2 === 1 ? -6 : 0)),
    });

    const { metrics } = compareLogs(makeLog(clean), makeLog(knocky));
    const avg = metrics.find((m) => m.key === "avgCorrection")!;
    const worst = metrics.find((m) => m.key === "worstCorrection")!;
    expect(avg.a).toBe(0);
    // Per sample the worst cylinder alternates −2 / −6 → mean ≈ −4.
    expect(avg.b).toBeCloseTo(-4, 1);
    expect(worst.b).toBe(-6);
    expect(avg.delta).toBeLessThan(0);
  });
});

describe("buildOverlay — resampling onto a shared axis", () => {
  it("resamples both logs onto a shared RPM grid", () => {
    const a = makeLog(verifiedPullColumns());
    const b = makeLog(verifiedPullColumns());
    const overlay = buildOverlay(a, b, "boost", { gridSize: 50 });
    expect(overlay.axis).toBe("rpm");
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
    const overlay = buildOverlay(a, makeLog(verifiedPullColumns()), "boost", { gridSize: 40 });
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
    const overlay = buildOverlay(a, b, "boost", { gridSize: 60 });
    expect(overlay.points[0].a).not.toBeNull();
    expect(overlay.points[0].b).toBeNull();
    expect(overlay.points[overlay.points.length - 1].b).not.toBeNull();
  });

  it("returns an empty overlay when the channel is missing from both logs", () => {
    const a = makeLog(verifiedPullColumns());
    const overlay = buildOverlay(a, a, "egt", { gridSize: 30 });
    expect(overlay.points).toHaveLength(0);
  });

  it("carries Boost Target as a companion trace on the boost channel", () => {
    const a = makeLog(verifiedPullColumns());
    const overlay = buildOverlay(a, a, "boost", { gridSize: 30 });
    expect(overlay.hasRef).toBe(true);
    expect(overlay.refLabel).toBe("Target");
    const mid = overlay.points[15];
    expect(mid.aRef).not.toBeNull();
    expect(mid.bRef).not.toBeNull();
    // The fixture logs actual 0.5 psi under target throughout.
    expect(mid.aRef! - mid.a!).toBeCloseTo(0.5, 3);
  });

  it("omits the companion trace on single-trace channels", () => {
    const cols = verifiedPullColumns();
    cols.push({ label: "IAT", unit: "°C", values: new Array(60).fill(40) });
    const log = makeLog(cols);
    const overlay = buildOverlay(log, log, "iat", { gridSize: 20 });
    expect(overlay.hasRef).toBe(false);
    expect(overlay.points[10].aRef).toBeUndefined();
  });
});

// End-to-end through the real CSV parser: guards the channel-label matching that
// the synthetic ColumnSpec fixtures deliberately bypass. Stock vs. Stage 1.
describe("compare pipeline — parsed sample logs", () => {
  const stock = parseLog(makeSampleCsv({ vin: "SYNTH0000000000A", peakBoost: 18 }));
  const stage1 = parseLog(makeSampleCsv({ vin: "SYNTH0000000000B", peakBoost: 22, knockDeg: -4, peakIat: 55 }));

  it("plots every offered overlay channel on both axes", () => {
    for (const channel of Object.keys(OVERLAY_CHANNELS) as OverlayChannel[]) {
      for (const axis of ["time", "rpm"] as const) {
        const overlay = buildOverlay(stock, stage1, channel, { axis, gridSize: 40 });
        expect(overlay.points.length, `${channel}/${axis}`).toBe(40);
        expect(
          overlay.points.some((p) => p.a !== null && p.b !== null),
          `${channel}/${axis} has overlapping data`,
        ).toBe(true);
      }
    }
  });

  it("keeps ignition advance and knock correction on separate traces", () => {
    const advance = buildOverlay(stock, stage1, "ignitionTiming", { gridSize: 40 });
    const correction = buildOverlay(stock, stage1, "timingCorrection", { gridSize: 40 });
    // Advance is a positive crank angle; the correction trace only ever pulls.
    expect(advance.points.every((p) => p.a === null || p.a > 0)).toBe(true);
    expect(correction.points.every((p) => p.b === null || p.b <= 0)).toBe(true);
    // Stage 1 knocks (−4°), stock does not.
    expect(correction.points.some((p) => p.b !== null && p.b < -1)).toBe(true);
    expect(correction.points.every((p) => p.a === null || p.a === 0)).toBe(true);
  });

  it("resolves lambda in λ and boost target as the companion trace", () => {
    const lambda = buildOverlay(stock, stage1, "lambda", { gridSize: 40 });
    expect(lambda.unit).toBe("λ");
    expect(lambda.points.every((p) => p.a === null || (p.a > 0.5 && p.a <= 1.05))).toBe(true);

    const boost = buildOverlay(stock, stage1, "boost", { gridSize: 40 });
    expect(boost.hasRef).toBe(true);
    expect(boost.points.some((p) => p.aRef !== null && p.aRef !== undefined)).toBe(true);
  });

  it("reports the expected direction on every headline metric", () => {
    const { metrics } = compareLogs(stock, stage1);
    const by = (k: string) => metrics.find((m) => m.key === k)!;
    expect(by("peakBoost").delta).toBeGreaterThan(0); // 22 vs 18 psi
    expect(by("maxIat").delta).toBeGreaterThan(0); // 55 vs 42 °C
    expect(by("worstCorrection").delta).toBeLessThan(0); // stage 1 knocks
    expect(by("iatRamp").delta).toBeGreaterThan(0); // and heat-soaks harder
    expect(by("spoolTime").a).not.toBeNull(); // real seconds axis
    expect(by("spoolRpm").a).not.toBeNull();
  });

  it("anchors both pulls at their own WOT start", () => {
    const { alignment } = compareLogs(stock, stage1);
    expect(alignment.a.pedalDriven).toBe(true);
    expect(alignment.b.pedalDriven).toBe(true);
    // The sample rolls onto full throttle over the first ~5 % of the log.
    expect(alignment.a.startIndex).toBeGreaterThan(0);
    expect(alignment.a.offset).toBeCloseTo(alignment.b.offset, 6);
  });
});

describe("buildOverlay — time axis & alignment", () => {
  /** Same pull, but the B recording idles for 2 s before the driver floors it. */
  function pair(): { a: ReturnType<typeof makeLog>; b: ReturnType<typeof makeLog> } {
    const cols = verifiedPullColumns();
    const lead: ColumnSpec[] = cols.map((c) => ({
      ...c,
      values: [...new Array(20).fill(c.label === "Pedal" ? 0 : c.values[0]), ...c.values],
    }));
    return {
      a: makeLog(cols, seconds()),
      b: makeLog(lead, seconds(80)),
    };
  }

  it("aligns both pulls at t=0 despite different recording lead-ins", () => {
    const { a, b } = pair();
    const overlay = buildOverlay(a, b, "boost", { axis: "time", align: "wot", gridSize: 80 });
    expect(overlay.axis).toBe("time");
    expect(overlay.xLabel).toContain("WOT");
    // With the anchors matched, the two traces agree wherever both are defined.
    const both = overlay.points.filter((p) => p.a !== null && p.b !== null && p.x >= 0);
    expect(both.length).toBeGreaterThan(10);
    for (const p of both) {
      expect(Math.abs(p.a! - p.b!)).toBeLessThan(0.2);
    }
  });

  it("leaves the two pulls offset from each other in raw mode", () => {
    const { a, b } = pair();
    const overlay = buildOverlay(a, b, "boost", { axis: "time", align: "raw", gridSize: 80 });
    expect(overlay.xLabel).not.toContain("WOT");
    // The 2 s lead-in now shows up as a real divergence between the traces.
    const both = overlay.points.filter((p) => p.a !== null && p.b !== null);
    expect(both.some((p) => Math.abs(p.a! - p.b!) > 1)).toBe(true);
  });

  it("keeps pre-pull samples as negative time on the aligned axis", () => {
    const { a, b } = pair();
    const overlay = buildOverlay(a, b, "boost", { axis: "time", align: "wot", gridSize: 60 });
    expect(overlay.points[0].x).toBeLessThan(0);
  });

  it("flags an approximate alignment when a log has no pedal channel", () => {
    const noPedal = makeLog(verifiedPullColumns().filter((c) => c.label !== "Pedal"), seconds());
    const withPedal = makeLog(verifiedPullColumns(), seconds());
    const overlay = buildOverlay(withPedal, noPedal, "boost", { axis: "time", align: "wot" });
    expect(overlay.approximateAlignment).toBe(true);
    // The RPM axis does not depend on the anchor, so it is never approximate.
    expect(buildOverlay(withPedal, noPedal, "boost", { axis: "rpm" }).approximateAlignment).toBe(false);
  });
});
