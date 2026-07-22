// Plain, framework-agnostic mirror of the `EnergyCategory` enum in
// schema.prisma. Kept separate (not derived from the generated Prisma client)
// so this file has zero Node-only dependencies and can be imported from
// client components — see `shared.ts` / the `@zaehlwerk/database/shared`
// export. Keep in sync with schema.prisma if categories change.
export const ENERGY_CATEGORIES = [
  "STROM",
  "GAS",
  "WASSER",
  "PV_ERZEUGUNG",
  "PV_EINSPEISUNG",
  "CUSTOM",
] as const;

export type EnergyCategoryValue = (typeof ENERGY_CATEGORIES)[number];

export const ENERGY_CATEGORY_LABELS: Record<EnergyCategoryValue, string> = {
  STROM: "Strom",
  GAS: "Gas",
  WASSER: "Wasser",
  PV_ERZEUGUNG: "PV-Erzeugung",
  PV_EINSPEISUNG: "PV-Einspeisung",
  CUSTOM: "Sonstiges",
};

export const ENERGY_CATEGORY_DEFAULT_UNITS: Record<EnergyCategoryValue, string> = {
  STROM: "kWh",
  GAS: "m³",
  WASSER: "m³",
  PV_ERZEUGUNG: "kWh",
  PV_EINSPEISUNG: "kWh",
  CUSTOM: "",
};
