import { describe, expect, it } from "vitest";
import {
  DEFAULT_VEHICLE_SPEC,
  limitsForSpec,
  summarizeSpec,
  type VehicleSpec,
} from "./vehicle-spec";
import { coerceSpec } from "./spec-store";

describe("limitsForSpec — contextual hardware limits", () => {
  it("gives a stricter EGT ceiling for an OEM cat than a catless setup", () => {
    const oem = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, catType: "oem" });
    const catless = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, catType: "catless" });
    const cat200 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, catType: "cat200" });
    expect(oem.maxEgt).toBeLessThan(cat200.maxEgt);
    expect(cat200.maxEgt).toBeLessThan(catless.maxEgt);
  });

  it("raises the boost ceiling for an upgraded turbo", () => {
    const stock = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, turbo: "stock" });
    const upgraded = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, turbo: "upgraded" });
    expect(upgraded.maxBoost).toBeGreaterThan(stock.maxBoost);
  });

  it("expects a higher minimum rail pressure from an upgraded HPFP", () => {
    const oem = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, hpfp: "oem" });
    const up = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, hpfp: "upgraded" });
    expect(up.minHpfpPressure).toBeGreaterThan(oem.minHpfpPressure);
  });

  it("adds EGT headroom for high-ethanol fuels", () => {
    const p98 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, fuel: "ron98" });
    const e85 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, fuel: "e85" });
    expect(e85.maxEgt).toBeGreaterThan(p98.maxEgt);
  });

  it("summarizes a spec as a single readable line", () => {
    const s = summarizeSpec(DEFAULT_VEHICLE_SPEC);
    expect(s).toMatch(/OEM/);
    expect(s).toMatch(/98 RON/);
  });
});

describe("coerceSpec — defensive loading", () => {
  it("falls back to defaults for a non-object", () => {
    expect(coerceSpec(null)).toEqual(DEFAULT_VEHICLE_SPEC);
    expect(coerceSpec("nope")).toEqual(DEFAULT_VEHICLE_SPEC);
  });

  it("keeps valid fields and replaces invalid ones", () => {
    const coerced = coerceSpec({
      engineCode: "S55B30T0",
      catType: "catless",
      fuel: "bogus",
      turbo: "upgraded",
      hpfp: 5,
    });
    const expected: VehicleSpec = {
      ...DEFAULT_VEHICLE_SPEC,
      engineCode: "S55B30T0",
      catType: "catless",
      fuel: DEFAULT_VEHICLE_SPEC.fuel,
      turbo: "upgraded",
      hpfp: DEFAULT_VEHICLE_SPEC.hpfp,
    };
    expect(coerced).toEqual(expected);
  });

  it("falls back to the default engine for an unknown engine code", () => {
    const coerced = coerceSpec({ engineCode: "NOT_AN_ENGINE" });
    expect(coerced.engineCode).toBe(DEFAULT_VEHICLE_SPEC.engineCode);
  });

  it("preserves an explicit null vehicle selection", () => {
    const coerced = coerceSpec({ brand: null, series: null, model: null });
    expect(coerced.brand).toBeNull();
    expect(coerced.model).toBeNull();
  });
});

describe("limitsForSpec — engine-driven baselines", () => {
  it("derives a lower stock-boost ceiling for a small B48 than a twin-turbo S55", () => {
    const b48 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, engineCode: "B48B20M0" });
    const s55 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, engineCode: "S55B30T0" });
    expect(b48.maxBoost).toBeLessThan(s55.maxBoost);
  });

  it("requires a higher redline sweep for the higher-revving S55", () => {
    const b58 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, engineCode: "B58B30M0" });
    const s55 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, engineCode: "S55B30T0" });
    expect(s55.rpmEndMin).toBeGreaterThan(b58.rpmEndMin);
  });

  it("lifts the boost ceiling (in bar) by the turbo-upgrade bonus", () => {
    const stock = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, turbo: "stock" });
    const up = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, turbo: "upgraded" });
    expect(up.maxBoost).toBeCloseTo(stock.maxBoost + 0.7, 5);
    // Metric: a stock BMW boost ceiling is ~1–2 bar, never a psi-scale number.
    expect(stock.maxBoost).toBeLessThan(3);
  });

  it("raises the boost ceiling with the tune stage", () => {
    const oem = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, stage: "oem" });
    const s1 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, stage: "stage1" });
    const s2 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, stage: "stage2" });
    expect(s1.maxBoost).toBeGreaterThan(oem.maxBoost);
    expect(s2.maxBoost).toBeGreaterThan(s1.maxBoost);
  });

  it("raises the EGT ceiling with the tune stage and keeps a realistic OEM value", () => {
    const oem = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, stage: "oem" });
    const s2 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, stage: "stage2" });
    expect(s2.maxEgt).toBeGreaterThan(oem.maxEgt);
    // OEM-cat ceiling must clear typical WOT EGTs (the reference log peaks ~997 °C).
    expect(oem.maxEgt).toBeGreaterThanOrEqual(950);
  });
});

describe("limitsForSpec — universal safety thresholds (engineProfiles)", () => {
  it("carries a cumulative-knock share in (0,1) for cylinder-count scaling", () => {
    const l = limitsForSpec(DEFAULT_VEHICLE_SPEC);
    expect(l.knockTotalShare).toBeGreaterThan(0);
    expect(l.knockTotalShare).toBeLessThan(1);
  });

  it("exposes a WOT lambda lean limit, an IAT warn point and a debounce window", () => {
    const l = limitsForSpec(DEFAULT_VEHICLE_SPEC);
    expect(l.maxLambdaWot).toBeCloseTo(0.92, 5);
    expect(l.iatWarn).toBe(50);
    expect(l.debounceSamples).toBeGreaterThanOrEqual(2);
  });

  it("allows a marginally leaner WOT lambda on high-ethanol fuel", () => {
    const p98 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, fuel: "ron98" });
    const e85 = limitsForSpec({ ...DEFAULT_VEHICLE_SPEC, fuel: "e85" });
    expect(e85.maxLambdaWot).toBeGreaterThan(p98.maxLambdaWot);
  });
});
