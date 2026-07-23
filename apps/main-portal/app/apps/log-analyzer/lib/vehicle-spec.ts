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

export type CatType = "oem" | "cat200" | "catless";
export type FuelType = "ron95" | "ron98" | "ron102" | "e30" | "e85";
export type TurboType = "stock" | "upgraded";
export type HpfpType = "oem" | "upgraded";

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
  // Hardware modifiers layered on top of the engine baseline:
  catType: CatType;
  fuel: FuelType;
  turbo: TurboType;
  hpfp: HpfpType;
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

/** Contextual plausibility / safety limits derived from a {@link VehicleSpec}. */
export interface SpecLimits {
  /**
   * Sustained EGT ceiling (°C). A stock catalyst is the most heat-sensitive
   * component, so it gets the strictest ceiling; a 200-cell metal cat tolerates
   * more, and a catless setup more still (nothing downstream to cook).
   */
  maxEgt: number;
  /** Plausible peak boost (psi) — the engine's stock ceiling, raised for an upgraded turbo. */
  maxBoost: number;
  /**
   * Minimum acceptable HPFP rail pressure (bar) under load. An OEM pump on a
   * high-demand tune drops pressure sooner than an upgraded one.
   */
  minHpfpPressure: number;
  /** Boost target↔actual gap (psi) beyond which a deviation is flagged. */
  boostDeviation: number;
  /** Fuel-trim (STFT/LTFT) magnitude (%) beyond which a lean/rich is flagged. */
  fuelTrimLimit: number;
  /** HPFP target↔actual drop (bar) beyond which fuel starvation is flagged. */
  hpfpDrop: number;
  /** Timing-correction (deg, negative) beyond which a knock alert is raised. */
  knockCorrection: number;
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

const EGT_BY_CAT: Record<CatType, number> = {
  // Serienkat: protect the substrate — flag earlier.
  oem: 900,
  // 200-Zeller Metallkat: more thermally robust.
  cat200: 950,
  // Catless: highest tolerance, limited by turbine/manifold rather than a cat.
  catless: 980,
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

/** Extra plausible boost (psi) an upgraded turbo can make over the stock ceiling. */
const TURBO_UPGRADE_BONUS_PSI = 10;

/** Throttle/pedal % threshold for Wide-Open-Throttle (WOT). */
export const WOT_THRESHOLD_PCT = 99;

/** Derive the contextual limits for a given vehicle & hardware setup. */
export function limitsForSpec(spec: VehicleSpec): SpecLimits {
  const engine = engineProfile(spec.engineCode);
  const t = engine.thresholds;

  // Aggressive fuels (high ethanol) run cooler EGTs for the same power, so a
  // little extra headroom is defensible; keep it modest and additive.
  const fuelEgtBonus = spec.fuel === "e85" ? 30 : spec.fuel === "e30" ? 15 : 0;

  return {
    // EGT stays cat-contextual (the catalyst, not the engine, is the heat-
    // sensitive component we protect), with a small high-ethanol allowance.
    maxEgt: EGT_BY_CAT[spec.catType] + fuelEgtBonus,
    // Boost baseline is the engine's stock ceiling; an upgraded turbo lifts it.
    maxBoost: t.stockBoostPsi + (spec.turbo === "upgraded" ? TURBO_UPGRADE_BONUS_PSI : 0),
    minHpfpPressure: HPFP_MIN_BY_PUMP[spec.hpfp],
    boostDeviation: t.boostDeviationPsi,
    fuelTrimLimit: t.fuelTrimLimitPct,
    hpfpDrop: t.hpfpDropBar,
    knockCorrection: t.knockCorrectionDeg,
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
    CAT_TYPE_LABELS[spec.catType],
    FUEL_LABELS[spec.fuel],
    TURBO_LABELS[spec.turbo],
    HPFP_LABELS[spec.hpfp],
  ].join(" · ");
}
