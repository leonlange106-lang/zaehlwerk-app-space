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
    const coerced = coerceSpec({ catType: "catless", fuel: "bogus", turbo: "upgraded", hpfp: 5 });
    const expected: VehicleSpec = {
      catType: "catless",
      fuel: DEFAULT_VEHICLE_SPEC.fuel,
      turbo: "upgraded",
      hpfp: DEFAULT_VEHICLE_SPEC.hpfp,
    };
    expect(coerced).toEqual(expected);
  });
});
