import {
  DEFAULT_DYNO_PROFILE,
  dynoProfileForVehicle,
  type DynoProfile,
  type TireSpec,
} from "./dyno-spec";
import type { VehicleSpec } from "./vehicle-spec";

// Browser-local persistence for the virtual dyno's vehicle-dynamics profile —
// same contract as spec-store.ts: localStorage only, nothing leaves the device,
// and reads are defensive so a corrupt or partial value degrades to the
// documented default instead of throwing (or worse, poisoning the physics with
// a NaN mass).

const PROFILE_KEY = "log-analyzer:dyno-profile";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** A finite number within [min, max], else the fallback. */
function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

function coerceTire(raw: unknown): TireSpec {
  const d = DEFAULT_DYNO_PROFILE.tire;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    widthMm: num(r.widthMm, d.widthMm, 100, 400),
    aspectPct: num(r.aspectPct, d.aspectPct, 15, 90),
    rimIn: num(r.rimIn, d.rimIn, 10, 26),
  };
}

/** Keep only plausible, strictly positive ratios; empty means "use the default". */
function coerceRatios(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DYNO_PROFILE.gearRatios];
  const ratios = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 20);
  return ratios.length > 0 ? ratios : [...DEFAULT_DYNO_PROFILE.gearRatios];
}

/** Validate a parsed object into a DynoProfile, filling gaps from the default. */
export function coerceDynoProfile(raw: unknown): DynoProfile {
  const d = DEFAULT_DYNO_PROFILE;
  if (!raw || typeof raw !== "object") return { ...d, tire: { ...d.tire }, gearRatios: [...d.gearRatios] };
  const r = raw as Record<string, unknown>;
  const gear = r.gear;
  return {
    presetId: typeof r.presetId === "string" && r.presetId !== "" ? r.presetId : null,
    massKg: num(r.massKg, d.massKg, 300, 5000),
    drivetrainLossPct: num(r.drivetrainLossPct, d.drivetrainLossPct, 0, 45),
    displacementL: num(r.displacementL, d.displacementL, 0.5, 10),
    volumetricEfficiency: num(r.volumetricEfficiency, d.volumetricEfficiency, 0.3, 1.5),
    gramsPerHp: num(r.gramsPerHp, d.gramsPerHp, 0.4, 1.5),
    tire: coerceTire(r.tire),
    gearRatios: coerceRatios(r.gearRatios),
    finalDrive: num(r.finalDrive, d.finalDrive, 1, 8),
    gear: typeof gear === "number" && Number.isFinite(gear) && gear >= 1 && gear <= 10 ? Math.round(gear) : null,
    dragCoefficient: num(r.dragCoefficient, d.dragCoefficient, 0.1, 1),
    frontalAreaM2: num(r.frontalAreaM2, d.frontalAreaM2, 1, 5),
    rollingResistance: num(r.rollingResistance, d.rollingResistance, 0.005, 0.05),
    rotatingMassFactor: num(r.rotatingMassFactor, d.rotatingMassFactor, 1, 1.3),
  };
}

export interface LoadedDynoProfile {
  profile: DynoProfile;
  /**
   * Where the returned profile came from:
   *  - "saved": the user's own, loaded from storage
   *  - "preset": derived from their vehicle profile's platform
   *  - "generic": no platform match — placeholder numbers, say so in the UI
   */
  origin: "saved" | "preset" | "generic";
}

/**
 * Load the dyno profile for a vehicle.
 *
 * A saved profile always wins and is returned untouched — it is the user's own
 * work. Only when nothing is stored is the starting point derived from the
 * vehicle profile, which is what makes the dyno open on THEIR car instead of
 * whichever platform happens to be first in the preset list.
 */
export function loadDynoProfile(spec: VehicleSpec): LoadedDynoProfile {
  const derive = (): LoadedDynoProfile => {
    const { profile, origin } = dynoProfileForVehicle(spec);
    return { profile, origin };
  };
  if (!hasWindow()) return derive();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return derive();
    return { profile: coerceDynoProfile(JSON.parse(raw)), origin: "saved" };
  } catch {
    return derive();
  }
}

/** Persist the dyno profile (best-effort; storage errors are swallowed). */
export function saveDynoProfile(profile: DynoProfile): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* quota/unavailable — non-fatal */
  }
}
