import { describe, expect, it } from "vitest";
import type { ConsumptionStats } from "./consumption";
import {
  combineRegisterStats,
  consumptionReadings,
  groupReadingsByRegister,
  hasMultipleRegisters,
  registersByDirection,
  type RegisterLike,
} from "./registers";

const BEZUG: RegisterLike = {
  id: "r-bezug",
  obisCode: "1.8.0",
  richtung: "BEZUG",
  label: "Bezug",
  sortIndex: 0,
};
const EINSPEISUNG: RegisterLike = {
  id: "r-einspeisung",
  obisCode: "2.8.0",
  richtung: "EINSPEISUNG",
  label: "Einspeisung",
  sortIndex: 3,
};

function reading(id: string, registerId: string | null) {
  return { id, registerId };
}

describe("groupReadingsByRegister", () => {
  it("trennt die verschraenkten Reihen eines Zweirichtungszaehlers", () => {
    // Der eigentliche Fall: Beide Zaehlwerke melden abwechselnd in dieselbe
    // Tabelle. Ungetrennt gerechnet folgt auf 45 000 Bezug ein Einspeisestand
    // von 1 200 — negatives Delta — und danach ein Sprung um 43 800 zurueck.
    const groups = groupReadingsByRegister(
      [BEZUG, EINSPEISUNG],
      [
        reading("b1", "r-bezug"),
        reading("e1", "r-einspeisung"),
        reading("b2", "r-bezug"),
        reading("e2", "r-einspeisung"),
      ],
    );

    expect(groups.map((g) => g.register.id)).toEqual(["r-bezug", "r-einspeisung"]);
    expect(groups[0]!.readings.map((r) => r.id)).toEqual(["b1", "b2"]);
    expect(groups[1]!.readings.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("schlaegt Staende ohne Zuordnung dem Bezug zu", () => {
    // `registerId: null` ist kein Fehler, sondern jeder Stand aus der Zeit vor
    // den Registern — und alles, was eine zurueckgerollte Anwendung schreibt.
    const groups = groupReadingsByRegister(
      [BEZUG, EINSPEISUNG],
      [reading("alt-1", null), reading("alt-2", null)],
    );

    expect(groups[0]!.readings.map((r) => r.id)).toEqual(["alt-1", "alt-2"]);
    expect(groups[1]!.readings).toEqual([]);
  });

  it("laesst ein Register ohne Staende stehen", () => {
    // Ein frisch angelegtes Einspeiseregister muss sichtbar sein, bevor der
    // erste Stand eingeht — sonst sieht das Anlegen aus wie ein Fehlschlag.
    const groups = groupReadingsByRegister([BEZUG, EINSPEISUNG], [reading("b1", "r-bezug")]);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.readings).toEqual([]);
  });

  it("verschluckt keinen Stand mit unbekanntem Register", () => {
    // Lieber an der falschen Stelle sichtbar als spurlos weg: Verbrauch, der
    // aus der Oberflaeche verschwindet, faellt niemandem auf.
    const groups = groupReadingsByRegister([BEZUG, EINSPEISUNG], [reading("x", "geloescht")]);
    expect(groups.flatMap((g) => g.readings.map((r) => r.id))).toEqual(["x"]);
  });

  it("sortiert Bezug vor Einspeisung, unabhaengig von der Eingabefolge", () => {
    const groups = groupReadingsByRegister([EINSPEISUNG, BEZUG], []);
    expect(groups.map((g) => g.register.obisCode)).toEqual(["1.8.0", "2.8.0"]);
  });
});

describe("consumptionReadings", () => {
  it("laesst Einspeisestaende aus der Verbrauchsreihe heraus", () => {
    const result = consumptionReadings(
      [BEZUG, EINSPEISUNG],
      [reading("b1", "r-bezug"), reading("e1", "r-einspeisung"), reading("b2", "r-bezug")],
    );
    expect(result.map((r) => r.id)).toEqual(["b1", "b2"]);
  });

  it("zieht Einspeisestaende NICHT ueber den Rueckfall wieder herein", () => {
    // Der Fehler, den die erste Fassung dieser Datei hatte: Gruppiert man gleich
    // nur ueber die Bezugsregister, ist die Kennung eines Einspeisestandes dort
    // unbekannt, und der Rueckfall aufs Standardregister holt genau die Werte
    // zurueck, die heraus sollen. Der Rueckfall gilt fuer Staende OHNE
    // Zuordnung, nicht fuer solche mit einer bewusst anderen.
    const result = consumptionReadings([BEZUG, EINSPEISUNG], [reading("e1", "r-einspeisung")]);
    expect(result).toEqual([]);
  });

  it("nimmt ohne Register die ganze Liste", () => {
    // Der gewoehnliche Zaehler und jeder Altbestand: Es gibt nichts zu trennen.
    const readings = [reading("a", null), reading("b", null)];
    expect(consumptionReadings([], readings)).toEqual(readings);
  });

  it("liefert fuer eine reine Erzeugungsanlage eine leere Reihe", () => {
    expect(consumptionReadings([EINSPEISUNG], [reading("e1", "r-einspeisung")])).toEqual([]);
  });
});

describe("combineRegisterStats", () => {
  function stats(partial: Partial<ConsumptionStats>): ConsumptionStats {
    return {
      total: 0,
      totalDays: 0,
      avgPerDay: null,
      maxPerDay: null,
      minPerDay: null,
      intervalCount: 0,
      hasImplausibleIntervals: false,
      ...partial,
    };
  }

  it("addiert den Verbrauch, aber NICHT den Zeitraum", () => {
    // Der Doppeltarifzaehler: 1.8.1 und 1.8.2 laufen parallel durch dasselbe
    // Jahr. Haengt man ihre Intervalle aneinander, zaehlt jeder Kalendertag
    // zweimal und der Tagesschnitt kommt halb so hoch heraus, wie er ist —
    // unauffaellig falsch, denn die Zahl sieht plausibel aus.
    const combined = combineRegisterStats([
      stats({ total: 2000, totalDays: 365, intervalCount: 12, avgPerDay: 2000 / 365 }),
      stats({ total: 1000, totalDays: 365, intervalCount: 12, avgPerDay: 1000 / 365 }),
    ]);

    expect(combined!.total).toBe(3000);
    expect(combined!.totalDays).toBe(365);
    expect(combined!.avgPerDay).toBeCloseTo(3000 / 365, 6);
    expect(combined!.intervalCount).toBe(24);
  });

  it("nimmt den laengsten Zeitraum, wenn die Reihen verschieden weit reichen", () => {
    // Ein spaeter nachgeruestetes Einspeiseregister reicht nicht so weit zurueck
    // wie der Bezug.
    const combined = combineRegisterStats([
      stats({ total: 4000, totalDays: 730, intervalCount: 24 }),
      stats({ total: 500, totalDays: 90, intervalCount: 3 }),
    ]);
    expect(combined!.totalDays).toBe(730);
  });

  it("meldet unplausible Intervalle, sobald EINE Reihe welche hat", () => {
    const combined = combineRegisterStats([
      stats({ total: 100, totalDays: 30, intervalCount: 1 }),
      stats({ total: 0, totalDays: 30, hasImplausibleIntervals: true }),
    ]);
    expect(combined!.hasImplausibleIntervals).toBe(true);
  });

  it("liefert null, wenn nichts zu berichten ist", () => {
    expect(combineRegisterStats([])).toBeNull();
    expect(combineRegisterStats([stats({})])).toBeNull();
  });
});

describe("Hilfsfragen", () => {
  it("meldet Mehrfachregister nur, wenn es sie gibt", () => {
    // Entscheidet in der Oberflaeche, ob sich ueberhaupt etwas aendert. Fuer den
    // gewoehnlichen Zaehler soll alles bleiben, wie es war.
    expect(hasMultipleRegisters([])).toBe(false);
    expect(hasMultipleRegisters([BEZUG])).toBe(false);
    expect(hasMultipleRegisters([BEZUG, EINSPEISUNG])).toBe(true);
  });

  it("filtert nach Richtung", () => {
    expect(registersByDirection([BEZUG, EINSPEISUNG], "EINSPEISUNG")).toEqual([EINSPEISUNG]);
  });
});
