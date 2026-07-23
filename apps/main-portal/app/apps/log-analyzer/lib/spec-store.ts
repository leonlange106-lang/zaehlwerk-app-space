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

/** Validate a parsed object into a VehicleSpec, filling gaps from the default. */
export function coerceSpec(raw: unknown): VehicleSpec {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VEHICLE_SPEC };
  const r = raw as Record<string, unknown>;
  return {
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
  };
}

/** Load the saved spec, or the default when none/unavailable/corrupt. */
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

/** Persist the vehicle spec (best-effort; storage errors are swallowed). */
export function saveVehicleSpec(spec: VehicleSpec): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(SPEC_KEY, JSON.stringify(spec));
  } catch {
    /* quota/unavailable — non-fatal */
  }
}
