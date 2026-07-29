import { describe, expect, it } from "vitest";
import { checkReadingPlausibility, describeImplausibleReading } from "./plausibility";
import type { ConsumptionInputReading } from "./consumption";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const reading = (
  id: string,
  iso: string,
  wert: number,
  extra: Partial<ConsumptionInputReading> = {},
): ConsumptionInputReading => ({
  id,
  datum: d(iso),
  wert,
  zaehlerGetauscht: false,
  startwertNeu: null,
  ...extra,
});

describe("checkReadingPlausibility", () => {
  it("laesst den ersten Stand einer Reihe durch", () => {
    const result = checkReadingPlausibility([], {
      datum: d("2026-01-01"),
      wert: 1000,
      zaehlerGetauscht: false,
      startwertNeu: null,
    });

    expect(result.implausible).toBe(false);
    // Kein Vorgaenger, also kein Intervall — daran haengt die Meldung, die
    // sonst eine Zahl nennen wuerde, die es nicht gibt.
    expect(result.interval).toBeNull();
  });

  it("laesst einen steigenden Stand durch", () => {
    const result = checkReadingPlausibility([reading("a", "2026-01-01", 1000)], {
      datum: d("2026-02-01"),
      wert: 1120,
      zaehlerGetauscht: false,
      startwertNeu: null,
    });

    expect(result.implausible).toBe(false);
    expect(result.interval?.amount).toBeCloseTo(120);
  });

  it("meldet einen Stand unter dem letzten", () => {
    const result = checkReadingPlausibility([reading("a", "2026-01-01", 1000)], {
      datum: d("2026-02-01"),
      wert: 958,
      zaehlerGetauscht: false,
      startwertNeu: null,
    });

    expect(result.implausible).toBe(true);
    expect(result.interval?.amount).toBeNull();
  });

  it("laesst einen Zaehlertausch mit Startwert durch", () => {
    // Genau der legitime Fall, den eine harte Ablehnung verboten haette: Der
    // neue Zaehler faengt bei 0 an, der Stand faellt also.
    const result = checkReadingPlausibility(
      [reading("a", "2026-01-01", 9000, { zaehlerGetauscht: true, startwertNeu: 0 })],
      { datum: d("2026-02-01"), wert: 80, zaehlerGetauscht: false, startwertNeu: null },
    );

    expect(result.implausible).toBe(false);
    expect(result.interval?.amount).toBeCloseTo(80);
  });

  it("rechnet beim Bearbeiten ohne den Stand, der geaendert wird", () => {
    const series = [reading("a", "2026-01-01", 1000), reading("b", "2026-02-01", 1200)];

    // "b" auf 1150 korrigieren: gegen "a" (1000) ist das plausibel. Ohne
    // excludeReadingId pruefte "b" gegen sich selbst (1200) und faellt.
    const edited = checkReadingPlausibility(
      series,
      { datum: d("2026-02-01"), wert: 1150, zaehlerGetauscht: false, startwertNeu: null },
      { excludeReadingId: "b" },
    );
    expect(edited.implausible).toBe(false);

    const withoutExclude = checkReadingPlausibility(series, {
      datum: d("2026-02-01"),
      wert: 1150,
      zaehlerGetauscht: false,
      startwertNeu: null,
    });
    expect(withoutExclude.implausible).toBe(true);
  });

  it("meldet auch beim Bearbeiten, wenn die Korrektur unter den Vorgaenger faellt", () => {
    const series = [reading("a", "2026-01-01", 1000), reading("b", "2026-02-01", 1200)];

    const result = checkReadingPlausibility(
      series,
      { datum: d("2026-02-01"), wert: 940, zaehlerGetauscht: false, startwertNeu: null },
      { excludeReadingId: "b" },
    );

    expect(result.implausible).toBe(true);
  });
});

describe("describeImplausibleReading", () => {
  it("nennt die konkrete Differenz mit Einheit", () => {
    // Die Zahl ist der ganze Zweck: "ungueltig" laesst nur raten, "-42 kWh"
    // macht den Tippfehler sichtbar.
    expect(describeImplausibleReading(1000, 958, "kWh")).toContain("-42 kWh");
  });
});
