import { limitsForSpec, type SpecLimits, type VehicleSpec } from "./vehicle-spec";

// User-defined limits on top of the derived ones (§ 6.3). Pure — no Prisma, no
// React — so the merge rules are the unit-test surface.
//
// **Only the overridden keys are stored.** Persisting a full copy of the limits
// would freeze the vehicle at the day it was created: every later correction to
// the threshold tables in `engines.ts`/`vehicle-spec.ts` would silently stop
// reaching it, and the maintained defaults would quietly become dead code for
// everyone who ever opened the form. A sparse patch means "I know better about
// exactly this one number" and leaves the rest maintained.

/** The limits a person may override. */
export const OVERRIDABLE_LIMITS = [
  "maxEgt",
  "maxBoost",
  "minHpfpPressure",
  "boostDeviation",
  "fuelTrimLimit",
  "hpfpDrop",
  "knockCorrection",
  "maxLambdaWot",
  "iatWarn",
] as const;

export type OverridableLimit = (typeof OVERRIDABLE_LIMITS)[number];

export type LimitOverrides = Partial<Record<OverridableLimit, number>>;

/**
 * Plausible ranges. A typo of one order of magnitude here does not produce a
 * wrong number on a screen — it silently reclassifies every stored log, because
 * the evaluation reads these. So the bounds are enforced on the way in rather
 * than trusted from the client.
 */
export const LIMIT_BOUNDS: Record<OverridableLimit, { min: number; max: number; unit: string }> = {
  maxEgt: { min: 600, max: 1100, unit: "°C" },
  maxBoost: { min: 0.2, max: 4, unit: "bar" },
  minHpfpPressure: { min: 20, max: 250, unit: "bar" },
  boostDeviation: { min: 0.05, max: 1.5, unit: "bar" },
  fuelTrimLimit: { min: 3, max: 40, unit: "%" },
  hpfpDrop: { min: 5, max: 150, unit: "bar" },
  // Negative: it is a timing CORRECTION, and "more" means further from zero.
  knockCorrection: { min: -15, max: -0.5, unit: "°KW" },
  maxLambdaWot: { min: 0.7, max: 1.2, unit: "λ" },
  iatWarn: { min: 30, max: 100, unit: "°C" },
};

export const LIMIT_LABELS: Record<OverridableLimit, string> = {
  maxEgt: "Max. Abgastemperatur",
  maxBoost: "Max. Ladedruck",
  minHpfpPressure: "Min. HPFP-Druck",
  boostDeviation: "Ladedruck-Abweichung",
  fuelTrimLimit: "Kraftstoff-Trim-Grenze",
  hpfpDrop: "HPFP-Druckabfall",
  knockCorrection: "Zündwinkelrücknahme",
  maxLambdaWot: "Magerste Lambda (WOT)",
  iatWarn: "Ansauglufttemperatur-Warnung",
};

function isOverridable(key: string): key is OverridableLimit {
  return (OVERRIDABLE_LIMITS as readonly string[]).includes(key);
}

/**
 * Parse whatever is in the database column into a trustworthy patch.
 *
 * Defensive in the same way the localStorage stores were: the column is JSON
 * written by an earlier version of this app, and a value that is out of range,
 * the wrong type, or for a key we no longer offer must degrade to "not
 * overridden" rather than reach the evaluation engine.
 */
export function parseLimitOverrides(raw: string | null | undefined): LimitOverrides {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const result: LimitOverrides = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isOverridable(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const { min, max } = LIMIT_BOUNDS[key];
    if (value < min || value > max) continue;
    result[key] = value;
  }
  return result;
}

export function serializeLimitOverrides(overrides: LimitOverrides): string {
  return JSON.stringify(parseLimitOverrides(JSON.stringify(overrides)));
}

/** The limits actually used: derived from the spec, then patched. */
export function effectiveLimits(spec: VehicleSpec, overrides: LimitOverrides): SpecLimits {
  return { ...limitsForSpec(spec), ...overrides };
}

/**
 * Is this value the user's, or the table's?
 *
 * The UI needs both — § 6.3 asks for the derived value struck through beside the
 * manual one. It also asks for the manual value in red, which on its own would
 * break the project rule that colour is never the sole carrier of meaning
 * (greyscale report prints, red-green deficiency). So the callers pair this with
 * a "manuell" label; this function is what tells them which rows need one.
 */
export function isOverridden(overrides: LimitOverrides, key: OverridableLimit): boolean {
  return overrides[key] !== undefined;
}

/** Rows for the limits table: derived value, override, and whether it differs. */
export function describeLimits(
  spec: VehicleSpec,
  overrides: LimitOverrides,
): { key: OverridableLimit; label: string; derived: number; value: number; manual: boolean; unit: string }[] {
  const derived = limitsForSpec(spec);
  return OVERRIDABLE_LIMITS.map((key) => ({
    key,
    label: LIMIT_LABELS[key],
    derived: derived[key],
    value: overrides[key] ?? derived[key],
    manual: isOverridden(overrides, key),
    unit: LIMIT_BOUNDS[key].unit,
  }));
}
