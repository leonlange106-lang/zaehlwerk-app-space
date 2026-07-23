// Engine & transmission catalogue for the Log Analyzer.
//
// The same boost/knock/fuel-trim reading means very different things on a small
// 2.0T four-cylinder than on a twin-turbo S55 — so the evaluation engine must be
// parameterised by the *exact* engine designation, not just the loose hardware
// modifiers (cat/fuel/turbo/pump). This module encodes the per-engine baseline
// thresholds as pure data plus the transmission list, so both the UI selectors
// and the pure evaluation engine can share one source of truth.
//
// Numbers here are conservative reference baselines for datalog plausibility /
// safety flagging — NOT manufacturer specifications. They are combined with the
// hardware modifiers in `vehicle-spec.ts` (`limitsForSpec`) to yield the final
// contextual limits a given build is judged against.

/** Exact engine designations we carry baseline thresholds for. */
export type EngineCode =
  | "B38B15M0"
  | "N20B20"
  | "B48B20M0"
  | "B48B20O0"
  | "N55B30M0"
  | "N54B30"
  | "B58B30M0"
  | "B58B30O1"
  | "S55B30T0"
  | "S58B30T0"
  | "S63B44";

/**
 * Per-engine baseline thresholds the evaluation engine reasons against. All
 * pressures are METRIC (bar) — relative boost / rail-pressure drop in bar.
 */
export interface EngineThresholds {
  /** Plausible peak (relative) boost on the *stock* turbo (bar); overboost above this. */
  stockBoostBar: number;
  /** Boost target↔actual gap (bar) at/beyond which we flag a deviation. */
  boostDeviationBar: number;
  /** Fuel-trim (STFT/LTFT) magnitude (%) at/beyond which we flag a lean/rich. */
  fuelTrimLimitPct: number;
  /** HPFP target↔actual rail-pressure drop (bar) that reads as fuel starvation. */
  hpfpDropBar: number;
  /** Timing-correction (deg, negative) at/beyond which we raise a knock alert. */
  knockCorrectionDeg: number;
  /** Engine redline (rpm) — a valid pull must sweep to near this. */
  redlineRpm: number;
}

export interface EngineProfile {
  code: EngineCode;
  /** Short human label incl. the trims it powers, e.g. "B48B20M0 (20i / 25i)". */
  label: string;
  /** Displacement / layout blurb for the UI. */
  displacement: string;
  thresholds: EngineThresholds;
}

// Baseline thresholds. `redlineRpm` drives the dynamic "reach near redline"
// end-of-pull requirement (see `pullRpmEndMin`); the rest feed the safety alerts.
export const ENGINES: Record<EngineCode, EngineProfile> = {
  B38B15M0: {
    code: "B38B15M0",
    label: "B38B15M0 (1.5T R3 — 116i / 118i)",
    displacement: "1.5L R3 Turbo",
    thresholds: { stockBoostBar: 1.2, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 12, knockCorrectionDeg: -3, redlineRpm: 6500 },
  },
  N20B20: {
    code: "N20B20",
    label: "N20B20 (2.0T — 328i / 428i / 528i)",
    displacement: "2.0L R4 Turbo",
    thresholds: { stockBoostBar: 1.3, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  B48B20M0: {
    code: "B48B20M0",
    label: "B48B20M0 (2.0T, mittlere Leistung — 120i / 320i / 420i)",
    displacement: "2.0L R4 Turbo (Ausbaustufe M)",
    thresholds: { stockBoostBar: 1.4, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  B48B20O0: {
    code: "B48B20O0",
    label: "B48B20O0 (2.0T, hohe Leistung — 125i / 230i / 330i / 30i)",
    displacement: "2.0L R4 Turbo (Ausbaustufe O)",
    thresholds: { stockBoostBar: 1.5, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  N55B30M0: {
    code: "N55B30M0",
    label: "N55B30M0 (135i / 335i / M2)",
    displacement: "3.0L R6 Single-Turbo",
    thresholds: { stockBoostBar: 1.3, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  N54B30: {
    code: "N54B30",
    label: "N54B30 (135i / 335i / 1M)",
    displacement: "3.0L R6 Twin-Turbo",
    thresholds: { stockBoostBar: 1.3, boostDeviationBar: 0.18, fuelTrimLimitPct: 12, hpfpDropBar: 18, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  B58B30M0: {
    code: "B58B30M0",
    label: "B58B30M0 (140i / 240i / 340i / 440i)",
    displacement: "3.0L R6 Single-Turbo",
    thresholds: { stockBoostBar: 1.5, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  B58B30O1: {
    code: "B58B30O1",
    label: "B58B30O1 (G-Serie 40i / GR Supra)",
    displacement: "3.0L R6 Single-Turbo (Ausbaustufe O)",
    thresholds: { stockBoostBar: 1.7, boostDeviationBar: 0.15, fuelTrimLimitPct: 10, hpfpDropBar: 15, knockCorrectionDeg: -3, redlineRpm: 7000 },
  },
  S55B30T0: {
    code: "S55B30T0",
    label: "S55B30T0 (M2 Comp / M3 / M4 F8x)",
    displacement: "3.0L R6 Twin-Turbo (M)",
    thresholds: { stockBoostBar: 1.7, boostDeviationBar: 0.2, fuelTrimLimitPct: 10, hpfpDropBar: 20, knockCorrectionDeg: -3, redlineRpm: 7600 },
  },
  S58B30T0: {
    code: "S58B30T0",
    label: "S58B30T0 (G8x M2 / M3 / M4)",
    displacement: "3.0L R6 Twin-Turbo (M)",
    thresholds: { stockBoostBar: 1.9, boostDeviationBar: 0.2, fuelTrimLimitPct: 10, hpfpDropBar: 22, knockCorrectionDeg: -3, redlineRpm: 7200 },
  },
  S63B44: {
    code: "S63B44",
    label: "S63B44 (M5 / M6 / X5 M / X6 M)",
    displacement: "4.4L V8 Twin-Turbo (M)",
    thresholds: { stockBoostBar: 1.5, boostDeviationBar: 0.2, fuelTrimLimitPct: 10, hpfpDropBar: 20, knockCorrectionDeg: -3, redlineRpm: 7200 },
  },
};

export const ENGINE_CODES = Object.keys(ENGINES) as EngineCode[];

/** A valid pull must begin at/below this rpm regardless of engine. */
export const PULL_RPM_START_MAX = 3000;

/**
 * The rpm a pull must reach to count as a full sweep to near redline — derived
 * from the engine's redline (~90%, rounded to 100 rpm). A short-shifted or
 * part-throttle sweep that never approaches this is not a verifiable pull.
 */
export function pullRpmEndMin(engine: EngineProfile): number {
  return Math.round((engine.thresholds.redlineRpm * 0.9) / 100) * 100;
}

/** Resolve an engine profile, defaulting to the common B58 when unknown. */
export function engineProfile(code: EngineCode): EngineProfile {
  return ENGINES[code] ?? ENGINES.B58B30M0;
}

// ── Transmissions ──────────────────────────────────────────────────────────
export const TRANSMISSIONS = {
  "ZF8HP45": "ZF 8HP45 — 8-Gang Automatik",
  "ZF8HP50": "ZF 8HP50 — 8-Gang Automatik",
  "ZF8HP51": "ZF 8HP51 — 8-Gang Automatik",
  "ZF8HP70": "ZF 8HP70 — 8-Gang Automatik",
  "ZF8HP75": "ZF 8HP75 — 8-Gang Automatik",
  "GS7D36SG": "GS7D36SG — 7-Gang M-DKG (DCT)",
  "GS6-53BZ": "GS6-53BZ — 6-Gang Handschaltung",
  "GS6-45BZ": "GS6-45BZ — 6-Gang Handschaltung",
} as const;

export type TransmissionCode = keyof typeof TRANSMISSIONS;

export const TRANSMISSION_CODES = Object.keys(TRANSMISSIONS) as TransmissionCode[];
