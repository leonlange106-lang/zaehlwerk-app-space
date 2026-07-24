import { describe, expect, it } from "vitest";
import { ENGINE_CODES } from "./engines";
import {
  applyVehicleEngine,
  DEFAULT_DYNO_PROFILE,
  engineDisplacementL,
  findDynoPreset,
} from "./dyno-spec";

describe("engineDisplacementL", () => {
  it("reads the litres off the engine catalogue's displacement blurb", () => {
    expect(engineDisplacementL("B58B30M0")).toBe(3.0);
    expect(engineDisplacementL("B38B15M0")).toBe(1.5);
    expect(engineDisplacementL("B48B20M0")).toBe(2.0);
  });

  it("parses every engine in the catalogue", () => {
    // Guards the format contract: this helper parses a field written for the UI,
    // so a new engine entry that breaks the pattern must fail here, loudly.
    for (const code of ENGINE_CODES) {
      const litres = engineDisplacementL(code);
      expect(litres, `engine ${code} has no parseable displacement`).not.toBeNull();
      expect(litres as number).toBeGreaterThan(0.5);
      expect(litres as number).toBeLessThan(10);
    }
  });
});

describe("applyVehicleEngine", () => {
  it("takes the displacement from the vehicle profile's engine", () => {
    const profile = { ...DEFAULT_DYNO_PROFILE, displacementL: 2.0 };
    expect(applyVehicleEngine(profile, "B58B30M0").displacementL).toBe(3.0);
    expect(applyVehicleEngine(profile, "S63B44").displacementL).toBe(4.4);
  });

  it("leaves every driver-adjustable value alone", () => {
    const profile = {
      ...DEFAULT_DYNO_PROFILE,
      displacementL: 2.0,
      massKg: 1725,
      tire: { widthMm: 265, aspectPct: 35, rimIn: 19 },
    };
    const synced = applyVehicleEngine(profile, "B58B30M0");
    expect(synced.massKg).toBe(1725);
    expect(synced.tire).toEqual({ widthMm: 265, aspectPct: 35, rimIn: 19 });
    expect(synced.gearRatios).toEqual(profile.gearRatios);
    expect(synced.drivetrainLossPct).toBe(profile.drivetrainLossPct);
  });

  it("returns the same object when the displacement already matches", () => {
    const profile = { ...DEFAULT_DYNO_PROFILE, displacementL: 3.0 };
    expect(applyVehicleEngine(profile, "B58B30M0")).toBe(profile);
  });
});

describe("findDynoPreset", () => {
  it("resolves the default profile's own preset", () => {
    expect(findDynoPreset(DEFAULT_DYNO_PROFILE.presetId)?.id).toBe(DEFAULT_DYNO_PROFILE.presetId);
  });

  it("returns null for an unknown or absent id", () => {
    expect(findDynoPreset("nope")).toBeNull();
    expect(findDynoPreset(null)).toBeNull();
  });
});
