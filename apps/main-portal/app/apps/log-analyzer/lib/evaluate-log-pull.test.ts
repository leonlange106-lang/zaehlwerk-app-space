import { describe, expect, it } from "vitest";
import { evaluateLogPull } from "./evaluate-log-pull";
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

  it("flags a mid-pull shift as INVALID (not a single gear)", () => {
    const cols = verifiedPullColumns();
    const gear = cols.find((c) => c.label === "Gear")!;
    // Shift 3 → 4 halfway through the pull.
    gear.values = gear.values.map((_, i) => (i < 30 ? 3 : 4));
    const { validity } = evaluateLogPull(makeLog(cols), SPEC);
    expect(validity.status).toBe("invalid");
    expect(validity.singleGear).toBe(false);
    expect(validity.reasons.join(" ")).toMatch(/Schaltvorgang/);
  });

  it("marks a partial-throttle sweep as INVALID when WOT coverage is very low", () => {
    const pedal = new Array(60).fill(50); // never reaches WOT
    const log = makeLog(verifiedPullColumns({ pedal }));
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.wot).toBe(false);
    expect(validity.status).toBe("invalid");
  });

  it("is PARTIAL when the RPM sweep is too short but throttle is full", () => {
    // Only spans 3000 → 5500: below start-max is fine, but never reaches 6000.
    const n = 60;
    const rpm = Array.from({ length: n }, (_, i) => 3000 + Math.round((i / (n - 1)) * 2500));
    const log = makeLog(verifiedPullColumns({ rpm }));
    const { validity } = evaluateLogPull(log, SPEC);
    expect(validity.rpmSpanOk).toBe(false);
    expect(validity.status).toBe("partial");
    expect(validity.reasons.join(" ")).toMatch(/Drehzahlfenster/);
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
    egt[50] = 930; // over OEM (900), under catless (980)
    cols.push({ label: "EGT", unit: "°C", values: egt });

    const oem = evaluateLogPull(makeLog(cols), { ...SPEC, catType: "oem" });
    expect(oem.alerts.find((a) => a.id === "egt-limit")).toBeDefined();

    const catless = evaluateLogPull(makeLog(cols), { ...SPEC, catType: "catless" });
    expect(catless.alerts.find((a) => a.id === "egt-limit")).toBeUndefined();
  });

  it("keeps a clean verified pull free of safety alerts", () => {
    const { alerts } = evaluateLogPull(makeLog(verifiedPullColumns()), SPEC);
    expect(alerts).toHaveLength(0);
  });
});
