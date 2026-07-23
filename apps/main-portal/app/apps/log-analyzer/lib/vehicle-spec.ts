// Vehicle & hardware setup profile plus the contextual limits derived from it.
// The same boost/EGT reading is "fine" or "dangerous" depending on the build:
// a stock catalyst must be protected with a stricter EGT ceiling than a catless
// downpipe, and a stock turbo simply can't make the boost an upgraded one can.
// This module encodes those relationships as pure data + a single derivation
// function so the evaluation engine stays free of hardware policy.

export type CatType = "oem" | "cat200" | "catless";
export type FuelType = "ron95" | "ron98" | "ron102" | "e30" | "e85";
export type TurboType = "stock" | "upgraded";
export type HpfpType = "oem" | "upgraded";

export interface VehicleSpec {
  catType: CatType;
  fuel: FuelType;
  turbo: TurboType;
  hpfp: HpfpType;
}

export const DEFAULT_VEHICLE_SPEC: VehicleSpec = {
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
  /** Plausible peak boost (psi) for the turbo — above this reads as overboost. */
  maxBoost: number;
  /**
   * Minimum acceptable HPFP rail pressure (bar) under load. An OEM pump on a
   * high-demand tune drops pressure sooner than an upgraded one.
   */
  minHpfpPressure: number;
  /** Short human explanation of what mainly drives the EGT ceiling. */
  egtRationale: string;
}

const EGT_BY_CAT: Record<CatType, number> = {
  // Serienkat: protect the substrate — flag earlier.
  oem: 900,
  // 200-Zeller Metallkat: more thermally robust.
  cat200: 950,
  // Catless: highest tolerance, limited by turbine/manifold rather than a cat.
  catless: 980,
};

const BOOST_BY_TURBO: Record<TurboType, number> = {
  stock: 24,
  upgraded: 34,
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

/** Derive the contextual limits for a given hardware setup. */
export function limitsForSpec(spec: VehicleSpec): SpecLimits {
  // Aggressive fuels (high ethanol) run cooler EGTs for the same power, so a
  // little extra headroom is defensible; keep it modest and additive.
  const fuelEgtBonus = spec.fuel === "e85" ? 30 : spec.fuel === "e30" ? 15 : 0;

  return {
    maxEgt: EGT_BY_CAT[spec.catType] + fuelEgtBonus,
    maxBoost: BOOST_BY_TURBO[spec.turbo],
    minHpfpPressure: HPFP_MIN_BY_PUMP[spec.hpfp],
    egtRationale: EGT_RATIONALE[spec.catType],
  };
}

/** A short one-line summary of a spec, e.g. for badges/headers. */
export function summarizeSpec(spec: VehicleSpec): string {
  return [
    CAT_TYPE_LABELS[spec.catType],
    FUEL_LABELS[spec.fuel],
    TURBO_LABELS[spec.turbo],
    HPFP_LABELS[spec.hpfp],
  ].join(" · ");
}
