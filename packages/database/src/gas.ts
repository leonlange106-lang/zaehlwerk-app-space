// Gas m³ → kWh = Verbrauch × Brennwert × Zustandszahl. Werte aus dem
// Original-Projekt (Za_hler.xlsm, Stand 2021+). Kanonische Heimat der
// Konstante; PDF-Report und Tarifrechnung nutzen sie.
export const GAS_BRENNWERT = 10.312; // kWh/m³
export const GAS_ZUSTANDSZAHL = 0.9622;
export const GAS_KWH_FACTOR = GAS_BRENNWERT * GAS_ZUSTANDSZAHL; // ≈ 9,922

export function gasM3ToKwh(m3: number): number {
  return m3 * GAS_KWH_FACTOR;
}
