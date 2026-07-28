/**
 * OBIS-Kennziffern, soweit Zählwerk sie deuten kann.
 *
 * Rein und ohne Datenbank — die Zuordnung "welche Kennziffer bedeutet was" ist
 * Fachwissen und gehört in den Testbereich, nicht in einen Route-Handler.
 *
 * Bewusst eine geschlossene Liste statt einer Ableitung aus dem ersten Feld:
 * Ein Tippfehler wie `1.9.0` sieht einer Ableitungsregel gültig aus und würde
 * eine zweite, stille Zeitreihe neben der richtigen eröffnen. Ein Fehler ist an
 * dieser Stelle deutlich billiger als ein zweiter Datenbestand, den erst Monate
 * später jemand bemerkt.
 */

export type RegisterRichtungValue = "BEZUG" | "EINSPEISUNG";

export interface ObisDescription {
  richtung: RegisterRichtungValue;
  /** Anzeigename des Registers. */
  label: string;
  /** HT/NT bei Doppeltarif, sonst null. */
  tarif: string | null;
}

/**
 * Die Kennziffern, die ein Haushaltszähler in Deutschland führt.
 *
 * 1.8.x zählt, was aus dem Netz bezogen wird, 2.8.x, was eingespeist wird. Die
 * Endziffer trennt den Doppeltarif: 0 = Gesamt, 1 = Hochtarif, 2 = Niedertarif.
 */
const OBIS: Record<string, ObisDescription> = {
  "1.8.0": { richtung: "BEZUG", label: "Bezug", tarif: null },
  "1.8.1": { richtung: "BEZUG", label: "Bezug HT", tarif: "HT" },
  "1.8.2": { richtung: "BEZUG", label: "Bezug NT", tarif: "NT" },
  "2.8.0": { richtung: "EINSPEISUNG", label: "Einspeisung", tarif: null },
  "2.8.1": { richtung: "EINSPEISUNG", label: "Einspeisung HT", tarif: "HT" },
  "2.8.2": { richtung: "EINSPEISUNG", label: "Einspeisung NT", tarif: "NT" },
};

/** Die Kennziffer, unter der ein Zähler ohne weitere Angabe geführt wird. */
export const DEFAULT_OBIS_CODE = "1.8.0";

/** Deutung einer Kennziffer, oder null wenn Zählwerk sie nicht kennt. */
export function describeObisCode(code: string): ObisDescription | null {
  return OBIS[code.trim()] ?? null;
}

/** Alle bekannten Kennziffern — für Fehlermeldungen, die weiterhelfen. */
export function knownObisCodes(): string[] {
  return Object.keys(OBIS);
}

/**
 * Sortierrang eines Registers: Bezug vor Einspeisung, Gesamt vor HT vor NT.
 * Damit steht in jeder Liste dieselbe Reihenfolge, ohne dass jemand sie pflegt.
 */
export function obisSortIndex(code: string): number {
  const order = knownObisCodes();
  const index = order.indexOf(code.trim());
  return index === -1 ? order.length : index;
}
