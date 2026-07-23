import { describe, expect, it } from "vitest";
import { evaluateLogPull, healthFromAlerts, toBar } from "./evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./vehicle-spec";
import { makeLog, verifiedPullColumns } from "./test-helpers";

// All fixtures are SYNTHETIC — no real vehicle data.

const SPEC: VehicleSpec = DEFAULT_VEHICLE_SPEC;

describe("evaluateLogPull — pull validity", () => {
  it("rates a clean full-throttle single-gear sweep as VERIFIED", () => {
    const log = makeLog(verifiedPullColumns());
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.status).toBe("verified");
    expect(validity.singleGear).toBe(true);
    expect(validity.gearValue).toBe(3);
    expect(validity.wot).toBe(true);
    expect(validity.rpmSpanOk).toBe(true);
    expect(validity.reasons).toHaveLength(0);
  });

  it("accepts a 3→4 upshift as a valid two-gear WOT pull", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    // Shift 3 → 4 halfway through the pull — a legal two-gear pull now.
    gear.values = gear.values.map((_, i) => (i < 30 ? 3 : 4));
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.status).toBe("verified");
    expect(validity.multiGear).toBe(true);
    expect(validity.gears).toEqual([3, 4]);
    expect(validity.singleGear).toBe(false);
  });

  it("marks a partial-throttle sweep as INVALID when WOT coverage is very low", () => {
    const pedal = new Array(60).fill(50); // never reaches WOT
    const log = makeLog(verifiedPullColumns({ pedal }));
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.wot).toBe(false);
    expect(validity.status).toBe("invalid");
  });

  it("is PARTIAL when the RPM sweep is too short but throttle is full", () => {
    // Spans ~3100 → 5500: starts a touch high and never reaches redline.
    const n = 60;
    const rpm = Array.from({ length: n }, (_, i) => 3000 + Math.round((i / (n - 1)) * 2500));
    const log = makeLog(verifiedPullColumns({ rpm }));
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.rpmSpanOk).toBe(false);
    expect(validity.status).toBe("partial");
    expect(validity.reasons.join(" ")).toMatch(/zu hoch|dreht nicht weit/);
  });

  it("is PARTIAL when throttle is unknown (no pedal channel)", () => {
    const cols = verifiedPullColumns().filter((c) => c.label !== "Pedal");
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.wot).toBeNull();
    expect(validity.wotCoverage).toBeNull();
    expect(validity.status).toBe("partial");
    expect(validity.reasons.join(" ")).toMatch(/Pedal/);
  });

  it("does not throw on an empty log and returns invalid", () => {
    const log = makeLog([{ label: "Note", values: [] }]);
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.status).toBe("invalid");
  });

  it("accepts a single-gear pull held in gear 5 (≥ min gear)", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    gear.values = gear.values.map(() => 5);
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.singleGear).toBe(true);
    expect(validity.gearValue).toBe(5);
    expect(validity.gearInRange).toBe(true);
    expect(validity.status).toBe("verified");
  });

  it("accepts gear 4 as a valid start gear", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    gear.values = gear.values.map(() => 4);
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.gearInRange).toBe(true);
    expect(validity.status).toBe("verified");
  });

  it("detects a real-world two-gear 5→6 highway pull as verified", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    // 5 → 6 upshift ~60% through — the exact shape of the reference logs.
    gear.values = gear.values.map((_, i) => (i < 35 ? 5 : 6));
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.status).toBe("verified");
    expect(validity.gears).toEqual([5, 6]);
    expect(validity.multiGear).toBe(true);
    expect(validity.gearInRange).toBe(true);
  });

  it("ignores a pull that starts in gear 2 (below the minimum gear)", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    gear.values = gear.values.map(() => 2);
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.gearInRange).toBe(false);
    expect(validity.status).toBe("invalid");
    expect(validity.reasons.join(" ")).toMatch(/Gang 1\/2|min\. Gang/);
  });

  it("starts the pull at the first WOT sample, excluding the pre-WOT ramp", () => {
    // Pedal ramps 0→100 across the first ten samples, then holds WOT.
    const pedal = Array.from({ length: 60 }, (_, i) => (i < 10 ? i * 10 : 100));
    const { window } = evaluateLogPull(makeLog(verifiedPullColumns({ pedal })), SPEC);
    // First index at/above 99% pedal is i = 10 (i = 9 is only 90%).
    expect(window[0]).toBe(10);
  });

  it("ends the pull when shifting into a THIRD gear (3→4→5 keeps only 3→4)", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    // 3 (early) → 4 (through redline) → 5 (last few samples, must be excluded).
    gear.values = gear.values.map((_, i) => (i < 10 ? 3 : i < 55 ? 4 : 5));
    const { validity, window } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.gears).toEqual([3, 4]);
    expect(window[1]).toBe(54); // last gear-4 sample; the 3rd-gear shift ends it
    expect(validity.status).toBe("verified");
  });
});

describe("evaluateLogPull — missing parameter hints", () => {
  it("warns when STFT and LTFT are absent", () => {
    const cols = verifiedPullColumns().filter((c) => c.label !== "STFT" && c.label !== "LTFT");
    const { missing } = evaluateLogPull(makeLog(cols), SPEC);
    const keys = missing.map((m) => m.key);
    expect(keys).toContain("stft");
    expect(keys).toContain("ltft");
    const stft = missing.find((m) => m.key === "stft")!;
    expect(stft.message).toMatch(/MGflasher-Logging-Profil/);
  });

  it("does not warn about STFT/LTFT when both are present", () => {
    const { missing } = evaluateLogPull(makeLog(verifiedPullColumns()), SPEC);
    const keys = missing.map((m) => m.key);
    expect(keys).not.toContain("stft");
    expect(keys).not.toContain("ltft");
  });

  it("warns when no timing/knock correction channel exists", () => {
    const cols = verifiedPullColumns().filter((c) => c.label !== "Ignition Correction");
    const { missing } = evaluateLogPull(makeLog(cols), SPEC);
    expect(missing.map((m) => m.key)).toContain("timingCorrection");
  });
});

describe("evaluateLogPull — safety alerts", () => {
  it("raises a critical knock alert when correction drops past -3° on a cylinder", () => {
    const correction = new Array(60).fill(0);
    correction[40] = -4.5;
    const { alerts } = evaluateLogPull(makeLog(verifiedPullColumns({ correction })), SPEC);
    const knock = alerts.find((a) => a.id === "knock");
    expect(knock).toBeDefined();
    expect(knock!.severity).toBe("critical");
    expect(knock!.title).toMatch(/-4\.5/);
  });

  it("reports 'multiple cylinders' when several correction channels pull", () => {
    const cols = verifiedPullColumns();
    const c1 = new Array(60).fill(0);
    const c2 = new Array(60).fill(0);
    c1[30] = -3.5;
    c2[31] = -5;
    cols.push({ label: "Knock Correction Cyl 1", unit: "°", values: c1 });
    cols.push({ label: "Knock Correction Cyl 2", unit: "°", values: c2 });
    const { alerts } = evaluateLogPull(makeLog(cols), SPEC);
    const knock = alerts.find((a) => a.id === "knock")!;
    expect(knock.detail).toMatch(/Zylindern/);
  });

  it("does not raise a knock alert for small (>-3°) corrections", () => {
    const correction = new Array(60).fill(-1.5);
    const { alerts } = evaluateLogPull(makeLog(verifiedPullColumns({ correction })), SPEC);
    expect(alerts.find((a) => a.id === "knock")).toBeUndefined();
  });

  it("flags a boost target↔actual deviation (leak/underboost)", () => {
    const cols = verifiedPullColumns();
    const target = cols.find((c) => c.label === "Boost Target")!;
    const actual = cols.find((c) => c.label === "Boost Actual")!;
    // Force a 4 psi shortfall near the top.
    actual.values = target.values.map((v, i) => (i > 40 ? (v as number) - 4 : (v as number) - 0.5));
    const { alerts } = evaluateLogPull(makeLog(cols), SPEC);
    const dev = alerts.find((a) => a.id === "boost-deviation");
    expect(dev).toBeDefined();
    expect(dev!.detail).toMatch(/zurück/);
  });

  it("flags boost above the stock-turbo plausibility ceiling", () => {
    const cols = verifiedPullColumns();
    const actual = cols.find((c) => c.label === "Boost Actual")!;
    actual.values = actual.values.map(() => 30); // > stock ceiling (24)
    const { alerts } = evaluateLogPull(makeLog(cols), SPEC);
    expect(alerts.find((a) => a.id === "boost-limit")).toBeDefined();
  });

  it("does not flag 30 psi for an upgraded turbo", () => {
    const cols = verifiedPullColumns();
    const actual = cols.find((c) => c.label === "Boost Actual")!;
    actual.values = actual.values.map(() => 30);
    const spec: VehicleSpec = { ...SPEC, turbo: "upgraded" };
    const { alerts } = evaluateLogPull(makeLog(cols), spec);
    expect(alerts.find((a) => a.id === "boost-limit")).toBeUndefined();
  });

  it("raises a critical HPFP alert when actual pressure collapses vs. target", () => {
    const cols = verifiedPullColumns();
    const n = cols[0].values.length;
    const tgt = new Array(n).fill(200);
    const act = new Array(n).fill(200);
    act[45] = 170; // 30 bar drop
    cols.push({ label: "HPFP Target Pressure", unit: "bar", values: tgt });
    cols.push({ label: "HPFP Actual Pressure", unit: "bar", values: act });
    const { alerts } = evaluateLogPull(makeLog(cols), SPEC);
    const hpfp = alerts.find((a) => a.id === "hpfp-drop");
    expect(hpfp).toBeDefined();
    expect(hpfp!.severity).toBe("critical");
  });

  it("raises an EGT alert above the OEM-cat ceiling but not above the catless one", () => {
    const cols = verifiedPullColumns();
    const n = cols[0].values.length;
    const egt = new Array(n).fill(500);
    egt[50] = 1000; // over OEM (960), under catless (1010)
    cols.push({ label: "EGT", unit: "°C", values: egt });

    const oem = evaluateLogPull(makeLog(cols), { ...SPEC, catType: "oem" });
    expect(oem.alerts.find((a) => a.id === "egt-limit")).toBeDefined();

    const catless = evaluateLogPull(makeLog(cols), { ...SPEC, catType: "catless" });
    expect(catless.alerts.find((a) => a.id === "egt-limit")).toBeUndefined();
  });

  it("flags a fuel trim beyond the engine's tolerance (lean)", () => {
    const stft = new Array(60).fill(2);
    stft[40] = 14; // > ±10%
    const { alerts } = evaluateLogPull(makeLog(verifiedPullColumns({ stft })), SPEC);
    const trim = alerts.find((a) => a.id === "trim-stft");
    expect(trim).toBeDefined();
    expect(trim!.detail).toMatch(/mageres/);
  });

  it("keeps a clean verified pull free of safety alerts", () => {
    const { alerts } = evaluateLogPull(makeLog(verifiedPullColumns()), SPEC);
    expect(alerts).toHaveLength(0);
  });
});

describe("evaluateLogPull — gear-shift exclusion zone", () => {
  it("suppresses an EGT spike that lands inside the post-shift zone", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    gear.values = gear.values.map((_, i) => (i < 30 ? 3 : 4)); // shift at i = 30
    const egt = new Array(60).fill(600);
    egt[31] = 1000; // right after the shift → excluded from evaluation
    cols.push({ label: "EGT", unit: "°C", values: egt });
    const { alerts, exclusionRanges } = evaluateLogPull(makeLog(cols), SPEC);
    expect(exclusionRanges.length).toBeGreaterThan(0);
    expect(alerts.find((a) => a.id === "egt-limit")).toBeUndefined();
  });

  it("still flags an EGT spike well away from any gear shift", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    gear.values = gear.values.map((_, i) => (i < 30 ? 3 : 4)); // shift at i = 30
    const egt = new Array(60).fill(600);
    egt[52] = 1000; // clear of the shift zone → evaluated
    cols.push({ label: "EGT", unit: "°C", values: egt });
    const { alerts } = evaluateLogPull(makeLog(cols), SPEC);
    expect(alerts.find((a) => a.id === "egt-limit")).toBeDefined();
  });
});

describe("healthFromAlerts — hardware health", () => {
  it("is safe with no alerts", () => {
    expect(healthFromAlerts([])).toBe("safe");
  });
  it("is caution with only warnings", () => {
    expect(healthFromAlerts([{ id: "x", severity: "warning", title: "", detail: "" }])).toBe("caution");
  });
  it("is danger when any critical alert is present", () => {
    expect(
      healthFromAlerts([
        { id: "a", severity: "warning", title: "", detail: "" },
        { id: "b", severity: "critical", title: "", detail: "" },
      ]),
    ).toBe("danger");
  });
});

describe("toBar — metric pressure normalization", () => {
  it("converts common logged units to bar", () => {
    expect(toBar(1000, "hPa")).toBeCloseTo(1.0, 5);
    expect(toBar(20, "MPa")).toBeCloseTo(200, 5);
    expect(toBar(100, "kPa")).toBeCloseTo(1.0, 5);
    expect(toBar(14.5038, "psi")).toBeCloseTo(1.0, 3);
    expect(toBar(1.5, "bar")).toBeCloseTo(1.5, 5);
    expect(toBar(1.5, null)).toBeCloseTo(1.5, 5);
  });
});

describe("evaluateLogPull — overlays (violations & pull range)", () => {
  it("pins a knock violation to the exact timestamp it occurred", () => {
    const correction = new Array(60).fill(0);
    correction[42] = -4.5;
    const time = Array.from({ length: 60 }, (_, i) => i * 0.1);
    const log = makeLog(verifiedPullColumns({ correction }), time);
    const { violations } = evaluateLogPull(log, SPEC);
    const knock = violations.find((v) => v.id.startsWith("knock"));
    expect(knock).toBeDefined();
    expect(knock!.sampleIndex).toBe(42);
    expect(knock!.time).toBeCloseTo(4.2);
    expect(knock!.severity).toBe("critical");
  });

  it("exposes a pull range spanning the detected sweep for a verified pull", () => {
    const time = Array.from({ length: 60 }, (_, i) => i * 0.1);
    const { pullRange, window } = evaluateLogPull(makeLog(verifiedPullColumns(), time), SPEC);
    expect(pullRange).not.toBeNull();
    expect(pullRange!.start).toBeCloseTo(time[window[0]]);
    expect(pullRange!.end).toBeCloseTo(time[window[1]]);
    expect(pullRange!.end).toBeGreaterThan(pullRange!.start);
  });

  it("has no violations on a clean pull", () => {
    const { violations } = evaluateLogPull(makeLog(verifiedPullColumns()), SPEC);
    expect(violations).toHaveLength(0);
  });
});
