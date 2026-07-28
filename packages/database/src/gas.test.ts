import { describe, expect, it } from "vitest";
import {
  convertGasToKwh,
  findOverlappingGasFactor,
  gasFactorValue,
  pickGasFactorForDate,
  type GasFactorInput,
} from "./gas";

const WINTER: GasFactorInput = {
  gueltigAb: new Date("2026-01-01T00:00:00Z"),
  gueltigBis: new Date("2026-01-31T23:59:59.999Z"),
  brennwert: 11.0,
  zustandszahl: 0.96,
};
const FEBRUAR: GasFactorInput = {
  gueltigAb: new Date("2026-02-01T00:00:00Z"),
  gueltigBis: null,
  brennwert: 10.0,
  zustandszahl: 0.96,
};

describe("pickGasFactorForDate", () => {
  it("nimmt den Faktor, der zum Zeitpunkt galt", () => {
    expect(pickGasFactorForDate([WINTER, FEBRUAR], new Date("2026-01-15"))).toBe(WINTER);
    expect(pickGasFactorForDate([WINTER, FEBRUAR], new Date("2026-03-15"))).toBe(FEBRUAR);
  });

  it("liefert null, wenn keiner gilt", () => {
    // Vor dem ersten gepflegten Zeitraum — nicht der naechstgelegene, sondern
    // gar keiner. Den Nachbarwert zu nehmen hiesse zu raten.
    expect(pickGasFactorForDate([WINTER, FEBRUAR], new Date("2025-06-01"))).toBeNull();
  });

  it("schliesst gueltigBis ein", () => {
    expect(pickGasFactorForDate([WINTER], new Date("2026-01-31T23:59:59.999Z"))).toBe(WINTER);
    expect(pickGasFactorForDate([WINTER], new Date("2026-02-01T00:00:00Z"))).toBeNull();
  });
});

describe("convertGasToKwh", () => {
  it("rechnet ein Intervall innerhalb EINES Faktors gerade durch", () => {
    const result = convertGasToKwh(
      100,
      new Date("2026-01-05"),
      new Date("2026-01-25"),
      [WINTER, FEBRUAR],
    );
    expect(result.complete).toBe(true);
    expect(result.kwh).toBeCloseTo(100 * gasFactorValue(WINTER), 6);
    expect(result.segments).toHaveLength(1);
  });

  it("verteilt ein Intervall UEBER einen Faktorwechsel anteilig nach Tagen", () => {
    // Der Kern von ZW-02. 20 Tage im Januar (Faktor 10,56), 20 im Februar
    // (9,60) — vorher haette der feste Faktor von 2021 fuer beide gegolten.
    const from = new Date("2026-01-12T00:00:00Z"); // 20 Tage bis 01.02.
    const to = new Date("2026-02-21T00:00:00Z"); // 20 Tage ab 01.02.
    const result = convertGasToKwh(400, from, to, [WINTER, FEBRUAR]);

    expect(result.complete).toBe(true);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.share).toBeCloseTo(0.5, 6);
    expect(result.segments[1]!.share).toBeCloseTo(0.5, 6);
    expect(result.kwh).toBeCloseTo(
      200 * gasFactorValue(WINTER) + 200 * gasFactorValue(FEBRUAR),
      6,
    );
  });

  it("weist den Wert als unvollstaendig aus, wenn ein Faktor fehlt", () => {
    // Bewusst `null` statt „mit dem Nachbarwert gerechnet": Ein geschaetzter
    // Brennwert sieht aus wie ein abgelesener, und niemand merkt je, dass die
    // Gasrechnung auf einer Annahme beruht.
    const result = convertGasToKwh(
      100,
      new Date("2025-12-15"),
      new Date("2026-01-15"),
      [WINTER, FEBRUAR],
    );

    expect(result.kwh).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.coverage).toBeGreaterThan(0);
    expect(result.coverage).toBeLessThan(1);
  });

  it("liefert null, wenn gar kein Faktor gepflegt ist", () => {
    const result = convertGasToKwh(100, new Date("2026-01-01"), new Date("2026-02-01"), []);
    expect(result.kwh).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.segments).toEqual([]);
  });

  it("nimmt ohne Vorintervall den Faktor am Endzeitpunkt", () => {
    // Die allererste Ablesung eines Zaehlers hat kein `from`.
    const result = convertGasToKwh(50, null, new Date("2026-01-10"), [WINTER, FEBRUAR]);
    expect(result.complete).toBe(true);
    expect(result.kwh).toBeCloseTo(50 * gasFactorValue(WINTER), 6);
  });

  it("erwischt am Wechseltag den richtigen Faktor", () => {
    // Nachgesehen wird in der MITTE jedes Abschnitts. Am Rand liegt gerade der
    // Wechsel, und je nach Rundung erwischte man den falschen der beiden.
    const result = convertGasToKwh(
      10,
      new Date("2026-01-31T00:00:00Z"),
      new Date("2026-02-02T00:00:00Z"),
      [WINTER, FEBRUAR],
    );
    expect(result.complete).toBe(true);
    expect(result.segments.map((s) => s.brennwert)).toEqual([11.0, 10.0]);
  });

  it("verliert nichts: die Abschnitte summieren sich zum Ganzen", () => {
    const result = convertGasToKwh(
      333,
      new Date("2026-01-10"),
      new Date("2026-03-10"),
      [WINTER, FEBRUAR],
    );
    const summe = result.segments.reduce((acc, s) => acc + s.kwh, 0);
    expect(summe).toBeCloseTo(result.kwh!, 6);
    expect(result.segments.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(1, 6);
  });
});

describe("findOverlappingGasFactor", () => {
  it("findet eine Ueberschneidung", () => {
    // Zwei gueltige Faktoren zur selben Zeit heisst: Es entscheidet die
    // Sortierung der Abfrage, welcher zaehlt — und die Kostenrechnung aendert
    // sich still, sobald jemand einen dritten anlegt.
    const kandidat: GasFactorInput = {
      gueltigAb: new Date("2026-01-15"),
      gueltigBis: new Date("2026-02-15"),
      brennwert: 10.5,
      zustandszahl: 0.96,
    };
    expect(findOverlappingGasFactor([WINTER, FEBRUAR], kandidat)).toBe(WINTER);
  });

  it("laesst einen luecklosen Anschluss durch", () => {
    const kandidat: GasFactorInput = {
      gueltigAb: new Date("2025-12-01"),
      gueltigBis: new Date("2025-12-31T23:59:59.999Z"),
      brennwert: 10.5,
      zustandszahl: 0.96,
    };
    expect(findOverlappingGasFactor([WINTER, FEBRUAR], kandidat)).toBeNull();
  });

  it("erkennt den offenen Zeitraum als bis in alle Ewigkeit", () => {
    // FEBRUAR hat kein `gueltigBis`. Ein neuer Faktor irgendwo danach
    // ueberschneidet sich also — sonst laege er unter zweien.
    const kandidat: GasFactorInput = {
      gueltigAb: new Date("2027-06-01"),
      brennwert: 10.5,
      zustandszahl: 0.96,
    };
    expect(findOverlappingGasFactor([FEBRUAR], kandidat)).toBe(FEBRUAR);
  });

  it("uebergeht den bearbeiteten Faktor selbst", () => {
    // Sonst koennte man einen Faktor nie speichern: Er ueberschneidet sich
    // immer mit sich selbst.
    const bestehend = [{ ...WINTER, id: "f1" }];
    expect(findOverlappingGasFactor(bestehend, WINTER, "f1")).toBeNull();
    expect(findOverlappingGasFactor(bestehend, WINTER)).not.toBeNull();
  });
});
