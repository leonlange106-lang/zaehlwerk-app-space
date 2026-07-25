// Vehicle-dynamics profile for the virtual dyno: the physical facts about the
// car that a datalog does NOT contain but the power estimate depends on — mass,
// drivetrain loss, displacement, tyre size, gearing and the aero/rolling
// coefficients. Kept separate from `vehicle-spec.ts` on purpose: that profile
// drives SAFETY thresholds (what is dangerous), this one drives PHYSICS (what
// the numbers mean). A car needs both, and they change for different reasons.
//
// Every number is an editable estimate. The presets are reference approximations
// for common platforms (kerb weight + 80 kg driver, published gear sets, typical
// drag figures) — good enough for a repeatable virtual dyno, never a substitute
// for a real one. Pure data + pure helpers, safe to import anywhere.

import { ENGINES, type EngineCode } from "./engines";

/** Tyre size in the usual 225/40R18 notation. */
export interface TireSpec {
  /** Section width in mm (the "225"). */
  widthMm: number;
  /** Aspect ratio in % (the "40"). */
  aspectPct: number;
  /** Rim diameter in inches (the "18"). */
  rimIn: number;
}

export interface DynoProfile {
  /** Id of the platform preset this came from, or null once edited manually. */
  presetId: string | null;
  /** Vehicle mass incl. driver & fuel (kg) — drives the acceleration method. */
  massKg: number;
  /** Drivetrain loss (%) between crank and wheels. */
  drivetrainLossPct: number;
  /** Engine displacement (L) — drives the VE-based airflow estimate. */
  displacementL: number;
  /**
   * Volumetric efficiency [0..1.3] used when airflow must be estimated from
   * boost/IAT because no MAF channel was logged. Modern turbo engines with
   * variable valve timing sit around 0.95 at full load; > 1 is possible on a
   * well-scavenged engine.
   */
  volumetricEfficiency: number;
  /**
   * The configurable efficiency offset of the air-mass method: grams of air per
   * second required for one crank horsepower. 0.8 g/s per hp is the widely used
   * baseline for modern turbo petrol engines (≈ 9.4 hp per lb/min); a leaner,
   * more efficient combustion makes more power per gram (lower value), a rich,
   * timing-retarded map less (higher value).
   */
  gramsPerHp: number;
  tire: TireSpec;
  /** Gear ratios, index 0 = 1st gear. */
  gearRatios: number[];
  finalDrive: number;
  /**
   * Gear the pull was driven in (1-based). Null = take it from the log's gear
   * channel. Only used when road speed has to be derived from engine speed.
   */
  gear: number | null;
  /** Drag coefficient (cW). */
  dragCoefficient: number;
  /** Frontal area (m²). */
  frontalAreaM2: number;
  /** Rolling-resistance coefficient of the tyres on tarmac. */
  rollingResistance: number;
  /**
   * Rotational-inertia allowance: accelerating the wheels, clutch and shafts
   * costs power on top of moving the mass, so the effective mass is a few
   * percent higher than the static one. ~1.06 in a mid/high gear.
   */
  rotatingMassFactor: number;
}

export interface DynoPreset {
  id: string;
  label: string;
  /**
   * The catalogue model (`vehicle-spec.ts` → `VehicleSpec.model`) this preset
   * describes, or null when the platform is not in the catalogue.
   *
   * Declared HERE rather than in a parallel lookup table: adding a preset then
   * forces you to say which car it is, and there is no second list to forget.
   */
  vehicleModelId: string | null;
  profile: Omit<DynoProfile, "presetId">;
}

// ZF 8HP (8HP45/50/51) — the gear set behind most F/G-series BMWs here.
const ZF8HP: number[] = [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64];
// VW DQ250-style 6-speed DSG (Golf 7 R approximation, single averaged final drive).
const DSG6: number[] = [3.462, 2.158, 1.469, 1.028, 0.809, 0.679];

export const DYNO_PRESETS: DynoPreset[] = [
  {
    id: "bmw-f20-125i-b48",
    label: "BMW F20 125i (B48B20O0)",
    vehicleModelId: "f20-125i",
    profile: {
      massKg: 1500,
      drivetrainLossPct: 15,
      displacementL: 2.0,
      volumetricEfficiency: 0.95,
      gramsPerHp: 0.8,
      tire: { widthMm: 225, aspectPct: 40, rimIn: 18 },
      gearRatios: ZF8HP,
      finalDrive: 3.08,
      gear: null,
      dragCoefficient: 0.3,
      frontalAreaM2: 2.16,
      rollingResistance: 0.012,
      rotatingMassFactor: 1.06,
    },
  },
  {
    id: "bmw-f20-m140i-b58",
    label: "BMW F20 M140i (B58B30M0)",
    vehicleModelId: "f20-m140i",
    profile: {
      massKg: 1600,
      drivetrainLossPct: 15,
      displacementL: 3.0,
      volumetricEfficiency: 0.95,
      gramsPerHp: 0.8,
      tire: { widthMm: 225, aspectPct: 40, rimIn: 18 },
      gearRatios: ZF8HP,
      finalDrive: 3.08,
      gear: null,
      dragCoefficient: 0.31,
      frontalAreaM2: 2.16,
      rollingResistance: 0.012,
      rotatingMassFactor: 1.06,
    },
  },
  {
    id: "bmw-f30-340i-b58",
    label: "BMW F30 340i (B58B30M0)",
    vehicleModelId: "f30-340i",
    profile: {
      massKg: 1680,
      drivetrainLossPct: 15,
      displacementL: 3.0,
      volumetricEfficiency: 0.95,
      gramsPerHp: 0.8,
      tire: { widthMm: 225, aspectPct: 45, rimIn: 18 },
      gearRatios: ZF8HP,
      finalDrive: 3.15,
      gear: null,
      dragCoefficient: 0.26,
      frontalAreaM2: 2.19,
      rollingResistance: 0.012,
      rotatingMassFactor: 1.06,
    },
  },
  {
    id: "vw-golf7-r-20tsi",
    label: "VW Golf 7 R (2.0 TSI, 4Motion)",
    vehicleModelId: null,
    profile: {
      // AWD costs noticeably more drivetrain loss than a RWD automatic.
      massKg: 1580,
      drivetrainLossPct: 20,
      displacementL: 2.0,
      volumetricEfficiency: 0.95,
      gramsPerHp: 0.8,
      tire: { widthMm: 225, aspectPct: 40, rimIn: 18 },
      gearRatios: DSG6,
      finalDrive: 3.94,
      gear: null,
      dragCoefficient: 0.32,
      frontalAreaM2: 2.19,
      rollingResistance: 0.012,
      rotatingMassFactor: 1.07,
    },
  },
];

/** The profile a fresh browser starts with (matches the default vehicle spec). */
export const DEFAULT_DYNO_PROFILE: DynoProfile = {
  presetId: "bmw-f20-m140i-b58",
  ...DYNO_PRESETS[1].profile,
};

/** Look up a preset by id. */
export function findDynoPreset(id: string | null): DynoPreset | null {
  return DYNO_PRESETS.find((p) => p.id === id) ?? null;
}

/** Rolling circumference of a tyre (m) from its 225/40R18-style dimensions. */
export function tireCircumferenceM(tire: TireSpec): number {
  const diameterMm = tire.rimIn * 25.4 + 2 * tire.widthMm * (tire.aspectPct / 100);
  return (Math.PI * diameterMm) / 1000;
}

/**
 * Total reduction between crank and wheel for a 1-based gear number, or null
 * when the profile carries no ratio for that gear.
 */
export function totalRatioFor(profile: DynoProfile, gear: number | null): number | null {
  if (gear === null || !Number.isFinite(gear)) return null;
  const ratio = profile.gearRatios[Math.round(gear) - 1];
  if (ratio === undefined || ratio <= 0 || profile.finalDrive <= 0) return null;
  return ratio * profile.finalDrive;
}

/**
 * Engine displacement in litres for an engine code, read off the engine
 * catalogue's `displacement` blurb ("3.0L R6 Single-Turbo" → 3.0).
 *
 * The catalogue stores that field for the UI, so it is the single source of
 * truth for what engine the car has; parsing it here avoids duplicating the
 * figure into a second table that could drift. Returns null if a future entry
 * ever breaks the format — callers keep their own value in that case. The
 * colocated test asserts every known code still parses.
 */
export function engineDisplacementL(code: EngineCode): number | null {
  const match = ENGINES[code]?.displacement.match(/^\s*(\d+(?:[.,]\d+)?)\s*L/i);
  if (!match) return null;
  const litres = Number(match[1].replace(",", "."));
  return Number.isFinite(litres) && litres > 0 ? litres : null;
}

/**
 * Return the profile with its displacement taken from the vehicle spec's engine.
 * The engine is a property of the CAR, configured once in the vehicle profile —
 * so the dyno derives it rather than asking for it a second time. Everything the
 * driver can actually change (mass, tyres, gearing, drag) is left untouched.
 */
export function applyVehicleEngine(profile: DynoProfile, engineCode: EngineCode): DynoProfile {
  const litres = engineDisplacementL(engineCode);
  if (litres === null || litres === profile.displacementL) return profile;
  return { ...profile, displacementL: litres };
}

/** The preset describing a catalogue model, or null when none does. */
export function dynoPresetForVehicleModel(modelId: string | null): DynoPreset | null {
  if (!modelId) return null;
  return DYNO_PRESETS.find((p) => p.vehicleModelId === modelId) ?? null;
}

/**
 * The profile a car should START from, derived from the vehicle profile.
 *
 * Used only when the user has never saved a dyno profile — an existing one is
 * their own work and is never overwritten. Two outcomes, and the difference
 * matters enough that `origin` reports it:
 *
 *  - "preset": the catalogue model has a reference platform, so mass, tyres,
 *    gearing and drag describe roughly the right car.
 *  - "generic": it does not. Displacement still comes from the engine code, but
 *    everything else is a placeholder. The UI has to say so — presenting one
 *    car's kerb weight and gear set as another's is how a virtual dyno produces
 *    a confident number about nothing.
 */
export function dynoProfileForVehicle(spec: { model: string | null; engineCode: EngineCode }): {
  profile: DynoProfile;
  origin: "preset" | "generic";
} {
  const preset = dynoPresetForVehicleModel(spec.model);
  if (preset) {
    return {
      profile: {
        presetId: preset.id,
        ...preset.profile,
        tire: { ...preset.profile.tire },
        gearRatios: [...preset.profile.gearRatios],
      },
      origin: "preset",
    };
  }
  const base: DynoProfile = {
    ...DEFAULT_DYNO_PROFILE,
    // No platform match, so this is not that platform's profile any more.
    presetId: null,
    tire: { ...DEFAULT_DYNO_PROFILE.tire },
    gearRatios: [...DEFAULT_DYNO_PROFILE.gearRatios],
  };
  return { profile: applyVehicleEngine(base, spec.engineCode), origin: "generic" };
}

/** One-line summary of a profile, for badges/headers. */
export function summarizeDynoProfile(profile: DynoProfile): string {
  const { tire } = profile;
  return [
    `${Math.round(profile.massKg)} kg`,
    `${profile.displacementL.toFixed(1)} L`,
    `${Math.round(profile.drivetrainLossPct)} % Verlust`,
    `${tire.widthMm}/${tire.aspectPct}R${tire.rimIn}`,
  ].join(" · ");
}
