import { ENGINES, TRANSMISSIONS } from "./engines";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./vehicle-spec";

// Browser-local persistence for the vehicle & hardware setup profile. Like the
// log history it lives in localStorage — nothing is sent to or stored on the
// server. Reads are defensive: a corrupt or partial value falls back to the
// documented default rather than throwing.

const SPEC_KEY = "log-analyzer:vehicle-spec";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

const CAT_VALUES = new Set(["oem", "cat200", "catless"]);
const FUEL_VALUES = new Set(["ron95", "ron98", "ron102", "e30", "e85"]);
const TURBO_VALUES = new Set(["stock", "upgraded"]);
const HPFP_VALUES = new Set(["oem", "upgraded"]);
const STAGE_VALUES = new Set(["oem", "stage1", "stage2", "custom"]);
const ENGINE_VALUES = new Set(Object.keys(ENGINES));
const TRANSMISSION_VALUES = new Set(Object.keys(TRANSMISSIONS));

/** Keep a nullable catalogue-id string field, else fall back to the default. */
function coerceIdOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && value !== "" ? value : fallback;
}

/** Validate a parsed object into a VehicleSpec, filling gaps from the default. */
export function coerceSpec(raw: unknown): VehicleSpec {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VEHICLE_SPEC };
  const r = raw as Record<string, unknown>;
  return {
    brand: coerceIdOrNull(r.brand, DEFAULT_VEHICLE_SPEC.brand),
    series: coerceIdOrNull(r.series, DEFAULT_VEHICLE_SPEC.series),
    model: coerceIdOrNull(r.model, DEFAULT_VEHICLE_SPEC.model),
    engineCode: ENGINE_VALUES.has(r.engineCode as string)
      ? (r.engineCode as VehicleSpec["engineCode"])
      : DEFAULT_VEHICLE_SPEC.engineCode,
    transmission: TRANSMISSION_VALUES.has(r.transmission as string)
      ? (r.transmission as VehicleSpec["transmission"])
      : DEFAULT_VEHICLE_SPEC.transmission,
    catType: CAT_VALUES.has(r.catType as string)
      ? (r.catType as VehicleSpec["catType"])
      : DEFAULT_VEHICLE_SPEC.catType,
    fuel: FUEL_VALUES.has(r.fuel as string)
      ? (r.fuel as VehicleSpec["fuel"])
      : DEFAULT_VEHICLE_SPEC.fuel,
    turbo: TURBO_VALUES.has(r.turbo as string)
      ? (r.turbo as VehicleSpec["turbo"])
      : DEFAULT_VEHICLE_SPEC.turbo,
    hpfp: HPFP_VALUES.has(r.hpfp as string)
      ? (r.hpfp as VehicleSpec["hpfp"])
      : DEFAULT_VEHICLE_SPEC.hpfp,
    stage: STAGE_VALUES.has(r.stage as string)
      ? (r.stage as VehicleSpec["stage"])
      : DEFAULT_VEHICLE_SPEC.stage,
  };
}

/**
 * Load the saved spec, or the default when none/unavailable/corrupt.
 *
 * READ-ONLY on purpose, and the last user of this key. Since vehicles moved to
 * the database nothing writes it any more — it survives solely as the one-time
 * seed for someone's FIRST vehicle (`VehicleSpecForm`), so an existing setup is
 * not lost on update. The matching `saveVehicleSpec()` was removed with the
 * vehicle chain: while it existed, it looked as though this store were still
 * live, and the views read from it and got the default forever.
 */
export function loadVehicleSpec(): VehicleSpec {
  if (!hasWindow()) return { ...DEFAULT_VEHICLE_SPEC };
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    if (!raw) return { ...DEFAULT_VEHICLE_SPEC };
    return coerceSpec(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VEHICLE_SPEC };
  }
}
