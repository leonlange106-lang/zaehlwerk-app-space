// Vehicle identity + hardware setup profile and the contextual limits derived
// from it. The same boost/EGT/knock reading is "fine" or "dangerous" depending
// on the build: the *engine designation* sets the baseline (a small B48 and a
// twin-turbo S55 tolerate very different boost and rail-pressure behaviour),
// while the hardware modifiers (cat / fuel / turbo / HPFP) shift those baselines
// (a stock catalyst needs a stricter EGT ceiling than a catless downpipe; an
// upgraded turbo can simply make more boost). This module encodes those
// relationships as pure data + a single derivation function so the evaluation
// engine stays free of hardware policy.

import {
  ENGINES,
  engineProfile,
  pullRpmEndMin,
  PULL_RPM_START_MAX,
  type EngineCode,
  type TransmissionCode,
} from "./engines";
import {
  DEBOUNCE_SAMPLES,
  IAT_RETARD_WARN_C,
  KNOCK_TOTAL_OFFSET_DEG,
  LAMBDA_WOT_LEAN_LIMIT,
} from "./engineProfiles";

export type CatType = "oem" | "cat200" | "catless";
export type FuelType = "ron95" | "ron98" | "ron102" | "e30" | "e85";
export type TurboType = "stock" | "upgraded";
export type HpfpType = "oem" | "upgraded";
/** Tune / map stage — a stronger map runs more boost and hotter, so it shifts limits. */
export type TuneStage = "oem" | "stage1" | "stage2" | "custom";

export interface VehicleSpec {
  /** Catalogue brand id (e.g. "bmw"), or null when set manually. */
  brand: string | null;
  /** Catalogue series id (e.g. "f22"), or null. */
  series: string | null;
  /** Catalogue model id (e.g. "f87-m2c"), or null. */
  model: string | null;
  /** Exact engine designation — the primary driver of the thresholds. */
  engineCode: EngineCode;
  /** Exact gearbox model (display / context only). */
  transmission: TransmissionCode;
  // Hardware & tune modifiers layered on top of the engine baseline:
  catType: CatType;
  fuel: FuelType;
  turbo: TurboType;
  hpfp: HpfpType;
  /** Tune stage (OEM / Stage 1 / Stage 2 / Custom map). */
  stage: TuneStage;
}

export const DEFAULT_VEHICLE_SPEC: VehicleSpec = {
  brand: "bmw",
  series: "f20",
  model: "f20-m140i",
  engineCode: "B58B30M0",
  transmission: "ZF8HP50",
  catType: "oem",
  fuel: "ron98",
  turbo: "stock",
  hpfp: "oem",
  stage: "oem",
};

/** Human-readable option labels (German UI). */
export const CAT_TYPE_LABELS: Record<CatType, string> = {
  oem: "OEM / Serienkat",
  cat200: "200-Zeller Metallkat",
  catless: "Catless (kein Kat)",
};

export const FUEL_LABELS: Record<FuelType, string> = {
  ron95: "95 RON",
  ron98: "98 RON",
  ron102: "102 RON",
  e30: "E30 (Ethanol-Mix)",
  e85: "E85",
};

export const TURBO_LABELS: Record<TurboType, string> = {
  stock: "Stock Turbo",
  upgraded: "Upgraded Turbo",
};

export const HPFP_LABELS: Record<HpfpType, string> = {
  oem: "HPFP OEM",
  upgraded: "HPFP TU / Upgrade",
};

export const STAGE_LABELS: Record<TuneStage, string> = {
  oem: "OEM / Serie",
  stage1: "Stage 1",
  stage2: "Stage 2",
  custom: "Custom Map",
};

/** Contextual plausibility / safety limits derived from a {@link VehicleSpec}. */
export interface SpecLimits {
  /**
   * Sustained EGT ceiling (°C). A stock catalyst is the most heat-sensitive
   * component, so it gets the strictest ceiling; a 200-cell metal cat tolerates
   * more, and a catless setup more still (nothing downstream to cook).
   */
  maxEgt: number;
  /** Plausible peak (relative) boost (bar) — engine stock ceiling + turbo + stage. */
  maxBoost: number;
  /**
   * Minimum acceptable HPFP rail pressure (bar) under load. An OEM pump on a
   * high-demand tune drops pressure sooner than an upgraded one.
   */
  minHpfpPressure: number;
  /** Boost target↔actual gap (bar) beyond which a deviation is flagged. */
  boostDeviation: number;
  /** Fuel-trim (STFT/LTFT) magnitude (%) beyond which a lean/rich is flagged. */
  fuelTrimLimit: number;
  /** HPFP target↔actual drop (bar) beyond which fuel starvation is flagged. */
  hpfpDrop: number;
  /** Timing-correction (deg, negative) beyond which a knock alert is raised. */
  knockCorrection: number;
  /**
   * Cumulative timing-correction (deg, negative) summed across ALL cylinders,
   * beyond which a knock alert is raised — catches several cylinders each pulling
   * a little at once even when no single one crosses `knockCorrection`.
   */
  knockCorrectionTotal: number;
  /** Leanest lambda (λ) tolerated under sustained WOT before a lean warning. */
  maxLambdaWot: number;
  /** Intake-air temp (°C) above which heat-driven timing retard is warned. */
  iatWarn: number;
  /**
   * Debounce window: minimum consecutive in-window samples a threshold must be
   * breached before an alert fires (single-sample transient suppression).
   */
  debounceSamples: number;
  /** Throttle/pedal % at/above which a sample counts as Wide-Open-Throttle. */
  wotThreshold: number;
  /** A valid pull must begin at/below this rpm. */
  rpmStartMax: number;
  /** A valid pull must reach at/above this rpm (near the engine's redline). */
  rpmEndMin: number;
  /** Short human explanation of what mainly drives the EGT ceiling. */
  egtRationale: string;
  /** The engine label the baseline came from (for UI context). */
  engineLabel: string;
}

// EGT ceilings (°C). Modern turbo BMWs routinely see 950–1000 °C at WOT on a
// tune (the reference Stage-1 log peaks ~997 °C), so the ceiling protects the
// heat-sensitive component (the catalyst) rather than flagging normal operation.
const EGT_BY_CAT: Record<CatType, number> = {
  // Serienkat: protect the substrate — the strictest ceiling.
  oem: 960,
  // 200-Zeller Metallkat: more thermally robust.
  cat200: 990,
  // Catless: highest tolerance, limited by turbine/manifold rather than a cat.
  catless: 1010,
};

const HPFP_MIN_BY_PUMP: Record<HpfpType, number> = {
  oem: 100,
  upgraded: 120,
};

const EGT_RATIONALE: Record<CatType, string> = {
  oem: "Serienkat: strengeres EGT-Limit zum Schutz des Katalysators.",
  cat200: "200-Zeller Metallkat: erhöhte EGT-Toleranz.",
  catless: "Catless: höchste EGT-Toleranz (kein Kat zu schützen).",
};

// A stronger map runs more boost and hotter EGTs by design, so both ceilings
// rise with stage. A custom map is treated as at least as aggressive as Stage 2.
const STAGE_BOOST_BONUS_BAR: Record<TuneStage, number> = {
  oem: 0,
  stage1: 0.3,
  stage2: 0.6,
  custom: 0.6,
};
const STAGE_EGT_BONUS_C: Record<TuneStage, number> = {
  oem: 0,
  stage1: 20,
  stage2: 40,
  custom: 40,
};
// A stronger map runs more aggressive boost control (bigger transient target↔
// actual swings on boost), so the deviation tolerance widens a little by stage.
const STAGE_BOOST_DEV_BONUS_BAR: Record<TuneStage, number> = {
  oem: 0,
  stage1: 0.05,
  stage2: 0.1,
  custom: 0.1,
};

/** Extra plausible boost (bar) an upgraded turbo can make over the stock ceiling. */
const TURBO_UPGRADE_BONUS_BAR = 0.7;

/** Throttle/pedal % threshold for Wide-Open-Throttle (WOT). */
export const WOT_THRESHOLD_PCT = 99;

/**
 * Derive the contextual limits from ALL factors: engine baseline + catalyst +
 * fuel + turbo + HPFP pump + tune stage. Pressures are metric (bar).
 */
export function limitsForSpec(spec: VehicleSpec): SpecLimits {
  const engine = engineProfile(spec.engineCode);
  const t = engine.thresholds;

  // Aggressive fuels (high ethanol) run cooler EGTs for the same power, so a
  // little extra headroom is defensible; keep it modest and additive.
  const fuelEgtBonus = spec.fuel === "e85" ? 30 : spec.fuel === "e30" ? 15 : 0;

  return {
    // EGT: cat-contextual base (the catalyst is the heat-sensitive component),
    // plus a high-ethanol allowance and a stage allowance (a stronger map runs
    // hotter by design).
    maxEgt: EGT_BY_CAT[spec.catType] + fuelEgtBonus + STAGE_EGT_BONUS_C[spec.stage],
    // Boost: engine stock ceiling, raised by an upgraded turbo and by the map
    // stage (a Stage 2 map commands materially more boost than OEM).
    maxBoost:
      t.stockBoostBar +
      (spec.turbo === "upgraded" ? TURBO_UPGRADE_BONUS_BAR : 0) +
      STAGE_BOOST_BONUS_BAR[spec.stage],
    minHpfpPressure: HPFP_MIN_BY_PUMP[spec.hpfp],
    boostDeviation: t.boostDeviationBar + STAGE_BOOST_DEV_BONUS_BAR[spec.stage],
    fuelTrimLimit: t.fuelTrimLimitPct,
    hpfpDrop: t.hpfpDropBar,
    knockCorrection: t.knockCorrectionDeg,
    knockCorrectionTotal: t.knockCorrectionDeg - KNOCK_TOTAL_OFFSET_DEG,
    // High-ethanol fuels are knock-resistant, so a marginally leaner reading
    // under load is less alarming — nudge the lean limit up a touch for E30/E85.
    maxLambdaWot:
      LAMBDA_WOT_LEAN_LIMIT + (spec.fuel === "e85" ? 0.03 : spec.fuel === "e30" ? 0.02 : 0),
    iatWarn: IAT_RETARD_WARN_C,
    debounceSamples: DEBOUNCE_SAMPLES,
    wotThreshold: WOT_THRESHOLD_PCT,
    rpmStartMax: PULL_RPM_START_MAX,
    rpmEndMin: pullRpmEndMin(engine),
    egtRationale: EGT_RATIONALE[spec.catType],
    engineLabel: engine.label,
  };
}

/** A short one-line summary of a spec, e.g. for badges/headers. */
export function summarizeSpec(spec: VehicleSpec): string {
  const engine = ENGINES[spec.engineCode]?.label ?? spec.engineCode;
  return [
    engine,
    STAGE_LABELS[spec.stage],
    CAT_TYPE_LABELS[spec.catType],
    FUEL_LABELS[spec.fuel],
    TURBO_LABELS[spec.turbo],
    HPFP_LABELS[spec.hpfp],
  ].join(" · ");
}
