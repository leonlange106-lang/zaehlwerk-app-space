import type { EngineCode, TransmissionCode } from "./engines";

// A curated vehicle tree (Brand → Series → Model) for the profile selectors.
// Each model lists the exact engine designations it shipped with and the
// gearboxes it was offered with, so picking a model narrows the engine and
// transmission choices to plausible ones. This is deliberately a *convenience*
// layer: the engine code is what actually drives the thresholds, and the user
// can always override it directly (or run with no vehicle selected at all).
//
// Coverage is representative of the MGflasher target platform (BMW), not
// exhaustive. Pure data — safe to import anywhere.

export interface CatalogModel {
  id: string;
  label: string;
  engines: EngineCode[];
  transmissions: TransmissionCode[];
}

export interface CatalogSeries {
  id: string;
  label: string;
  models: CatalogModel[];
}

export interface CatalogBrand {
  id: string;
  label: string;
  series: CatalogSeries[];
}

const AUTO_ZF50: TransmissionCode[] = ["ZF8HP50", "GS6-45BZ"];
const AUTO_ZF51: TransmissionCode[] = ["ZF8HP51", "GS6-45BZ"];
const M_DCT_OR_MANUAL: TransmissionCode[] = ["GS7D36SG", "GS6-53BZ"];
const AUTO_ZF70: TransmissionCode[] = ["ZF8HP70", "ZF8HP75"];

export const VEHICLE_CATALOG: CatalogBrand[] = [
  {
    id: "bmw",
    label: "BMW",
    series: [
      {
        id: "f20",
        label: "1er (F20 / F21)",
        models: [
          { id: "f20-118i", label: "118i", engines: ["B38B15M0"], transmissions: AUTO_ZF50 },
          { id: "f20-120i", label: "120i", engines: ["B48B20M0"], transmissions: AUTO_ZF50 },
          // 125i is the high-output 2.0 (B48B20O0), not the mid-output M0.
          { id: "f20-125i", label: "125i", engines: ["B48B20O0"], transmissions: AUTO_ZF50 },
          { id: "f20-m140i", label: "M140i", engines: ["B58B30M0"], transmissions: AUTO_ZF50 },
        ],
      },
      {
        id: "f22",
        label: "2er (F22 / F23 / F87)",
        models: [
          { id: "f22-220i", label: "220i", engines: ["B48B20M0"], transmissions: AUTO_ZF50 },
          { id: "f22-228i", label: "228i", engines: ["N20B20"], transmissions: AUTO_ZF50 },
          { id: "f22-230i", label: "230i", engines: ["B48B20O0"], transmissions: AUTO_ZF50 },
          { id: "f22-m235i", label: "M235i", engines: ["N55B30M0"], transmissions: AUTO_ZF50 },
          { id: "f22-m240i", label: "M240i", engines: ["B58B30M0"], transmissions: AUTO_ZF50 },
          { id: "f87-m2", label: "M2 (F87)", engines: ["N55B30M0"], transmissions: M_DCT_OR_MANUAL },
          { id: "f87-m2c", label: "M2 Competition / CS", engines: ["S55B30T0"], transmissions: M_DCT_OR_MANUAL },
        ],
      },
      {
        id: "f30",
        label: "3er (F30 / F31 / F34)",
        models: [
          { id: "f30-320i", label: "320i", engines: ["N20B20", "B48B20M0"], transmissions: AUTO_ZF50 },
          { id: "f30-330i", label: "330i", engines: ["B48B20O0"], transmissions: AUTO_ZF50 },
          { id: "f30-335i", label: "335i", engines: ["N55B30M0"], transmissions: AUTO_ZF50 },
          { id: "f30-340i", label: "340i", engines: ["B58B30M0"], transmissions: AUTO_ZF50 },
        ],
      },
      {
        id: "f80",
        label: "M3 / M4 (F80 / F82 / F83)",
        models: [
          { id: "f80-m3", label: "M3 (F80)", engines: ["S55B30T0"], transmissions: M_DCT_OR_MANUAL },
          { id: "f82-m4", label: "M4 (F82 / F83)", engines: ["S55B30T0"], transmissions: M_DCT_OR_MANUAL },
        ],
      },
      {
        id: "g20",
        label: "3er (G20 / G21)",
        models: [
          { id: "g20-320i", label: "320i", engines: ["B48B20M0"], transmissions: AUTO_ZF51 },
          { id: "g20-330i", label: "330i", engines: ["B48B20O0"], transmissions: AUTO_ZF51 },
          { id: "g20-m340i", label: "M340i", engines: ["B58B30O1"], transmissions: AUTO_ZF51 },
        ],
      },
      {
        id: "g8x",
        label: "M3 / M4 (G80 / G82)",
        models: [
          { id: "g80-m3", label: "M3 (G80)", engines: ["S58B30T0"], transmissions: ["ZF8HP51", "GS6-53BZ"] },
          { id: "g82-m4", label: "M4 (G82)", engines: ["S58B30T0"], transmissions: ["ZF8HP51", "GS6-53BZ"] },
        ],
      },
      {
        id: "f10",
        label: "5er / 6er (F10 / F06 / F12)",
        models: [
          { id: "f10-535i", label: "535i", engines: ["N55B30M0"], transmissions: AUTO_ZF70 },
          { id: "f10-m5", label: "M5 / M6 (F10 / F06)", engines: ["S63B44"], transmissions: ["GS7D36SG", "ZF8HP70"] },
        ],
      },
    ],
  },
  {
    id: "toyota",
    label: "Toyota",
    series: [
      {
        id: "a90",
        label: "GR Supra (A90 / A91)",
        models: [
          { id: "a90-supra", label: "GR Supra 3.0", engines: ["B58B30O1"], transmissions: ["ZF8HP51", "GS6-53BZ"] },
        ],
      },
    ],
  },
];

export interface ModelLocation {
  brand: CatalogBrand;
  series: CatalogSeries;
  model: CatalogModel;
}

/** Find a model (and its brand/series) by model id, or null. */
export function findModel(modelId: string | null): ModelLocation | null {
  if (!modelId) return null;
  for (const brand of VEHICLE_CATALOG) {
    for (const series of brand.series) {
      const model = series.models.find((m) => m.id === modelId);
      if (model) return { brand, series, model };
    }
  }
  return null;
}
