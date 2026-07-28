import { describe, expect, it } from "vitest";
import {
  DEFAULT_OBIS_CODE,
  describeObisCode,
  knownObisCodes,
  obisSortIndex,
} from "./obis";

describe("describeObisCode", () => {
  it("trennt Bezug von Einspeisung", () => {
    expect(describeObisCode("1.8.0")?.richtung).toBe("BEZUG");
    expect(describeObisCode("2.8.0")?.richtung).toBe("EINSPEISUNG");
  });

  it("erkennt den Doppeltarif an der Endziffer", () => {
    expect(describeObisCode("1.8.1")?.tarif).toBe("HT");
    expect(describeObisCode("1.8.2")?.tarif).toBe("NT");
    expect(describeObisCode("1.8.0")?.tarif).toBeNull();
  });

  it("weist eine unbekannte Kennziffer ab, statt sie zu raten", () => {
    // Der Kern der Entscheidung: `1.9.0` sähe einer Ableitungsregel ("erste
    // Ziffer 1 = Bezug") gültig aus. Sie anzunehmen hiesse, neben der richtigen
    // Zeitreihe still eine zweite zu eröffnen — teurer als ein Fehler.
    expect(describeObisCode("1.9.0")).toBeNull();
    expect(describeObisCode("3.8.0")).toBeNull();
    expect(describeObisCode("")).toBeNull();
  });

  it("ignoriert umgebende Leerzeichen", () => {
    expect(describeObisCode("  2.8.0 ")?.label).toBe("Einspeisung");
  });
});

describe("Sortierung", () => {
  it("stellt Bezug vor Einspeisung und Gesamt vor HT/NT", () => {
    const codes = ["2.8.1", "1.8.2", "2.8.0", "1.8.0"];
    const sorted = [...codes].sort((a, b) => obisSortIndex(a) - obisSortIndex(b));
    expect(sorted).toEqual(["1.8.0", "1.8.2", "2.8.0", "2.8.1"]);
  });

  it("haengt Unbekanntes hinten an, statt es vorzuziehen", () => {
    expect(obisSortIndex("9.9.9")).toBeGreaterThanOrEqual(knownObisCodes().length);
  });
});

describe("Standardkennziffer", () => {
  it("ist der Bezug — die Reihe, die jeder bestehende Zaehler fuehrt", () => {
    expect(DEFAULT_OBIS_CODE).toBe("1.8.0");
    expect(describeObisCode(DEFAULT_OBIS_CODE)?.richtung).toBe("BEZUG");
  });
});
