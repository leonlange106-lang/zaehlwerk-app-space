import { describe, expect, it } from "vitest";
import { projectAnnualConsumption } from "./projection";
import type { ConsumptionInputReading } from "./consumption";

const DAY = 86_400_000;

function r(dateISO: string, wert: number): ConsumptionInputReading {
  return { id: dateISO, datum: new Date(dateISO), wert, zaehlerGetauscht: false, startwertNeu: null };
}

describe("projectAnnualConsumption — gleitendes Jahr (Jahresablesung)", () => {
  it("liefert eine Hochrechnung, obwohl im laufenden Kalenderjahr keine Ablesung liegt", () => {
    // Reale Jahresablesungen: jeweils Anfang September. „Jetzt" ist der Juli des
    // Folgejahres — im laufenden Kalenderjahr steht KEINE Ablesung. Die alte
    // Kalenderjahr-Hochrechnung hätte hier `null` geliefert.
    const result = projectAnnualConsumption({
      readings: [
        r("2023-09-05T00:00:00Z", 1000),
        r("2024-09-05T00:00:00Z", 1360), // +360 über ~366 Tage
      ],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2025-07-01T00:00:00Z"),
    });

    expect(result.projectedAnnual).not.toBeNull();
    // Das gleitende Jahr endet an der jüngsten Ablesung und deckt genau das
    // letzte Intervall ab → Hochrechnung ≈ gemessener Jahresverbrauch (360,
    // auf 365 Tage normiert; das Intervall selbst ist ein 366-Tage-Schaltjahr).
    expect(result.projectedAnnual!).toBeGreaterThan(357);
    expect(result.projectedAnnual!).toBeLessThan(361);
    expect(result.year).toBe(2024); // Bezugsjahr = Jahr der Anker-Ablesung
    expect(result.anchorDate.slice(0, 10)).toBe("2024-09-05");
    expect(result.confidence).toBe("high");
  });

  it("vergleicht mit dem gleitenden Vorjahr statt dem Kalender-Vorjahr", () => {
    const result = projectAnnualConsumption({
      readings: [
        r("2022-09-05T00:00:00Z", 0),
        r("2023-09-05T00:00:00Z", 1000), // Vorjahr ≈ 1000
        r("2024-09-05T00:00:00Z", 2200), // letztes Jahr ≈ 1200
      ],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2025-01-01T00:00:00Z"),
    });

    // Auf 365 Tage normiert (Intervalle ~366 Tage) → knapp unter 1200 / 1000.
    expect(result.projectedAnnual!).toBeGreaterThan(1190);
    expect(result.projectedAnnual!).toBeLessThan(1200);
    expect(result.previousYearConsumption!).toBeGreaterThan(990);
    expect(result.previousYearConsumption!).toBeLessThan(1010);
    // ~1200 vs ~1000 → +20 %.
    expect(result.deltaConsumptionPct!).toBeGreaterThan(15);
    expect(result.deltaConsumptionPct!).toBeLessThan(25);
  });
});

describe("projectAnnualConsumption — unterjährige Ablesungen", () => {
  it("extrapoliert eine kurze Messstrecke deckungsnormiert auf ein Jahr", () => {
    // Zwei Ablesungen im Abstand von 182 Tagen; jüngste = Anker.
    const result = projectAnnualConsumption({
      readings: [r("2024-01-01T00:00:00Z", 0), r("2024-07-01T00:00:00Z", 100)],
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now: new Date("2024-07-01T00:00:00Z"),
    });

    // 100 über 182 Tage → ~365/182 × 100 hochgerechnet.
    expect(result.windowConsumption).toBeCloseTo(100, 5);
    expect(result.coveredDays).toBeCloseTo(182, 0);
    expect(result.projectedAnnual!).toBeCloseTo((100 * 365) / 182, 1);
    expect(result.projectedAnnual!).toBeGreaterThan(result.windowConsumption);
    // Nur die halbe Jahresstrecke ist erfasst → „mittel", nicht „hoch".
    expect(result.confidence).toBe("medium");
  });

  it("meldet niedrige Konfidenz bei nur wenigen erfassten Tagen", () => {
    const result = projectAnnualConsumption({
      readings: [r("2024-01-01T00:00:00Z", 0), r("2024-01-05T00:00:00Z", 20)],
      kategorie: "STROM",
      einheit: "kWh",
      method: "linear",
      now: new Date("2024-01-06T00:00:00Z"), // nur 4 erfasste Tage
    });
    expect(result.confidence).toBe("low");
  });
});

describe("projectAnnualConsumption — Grenzfälle", () => {
  it("liefert null-Hochrechnung mit niedriger Konfidenz bei einer einzelnen Ablesung", () => {
    const result = projectAnnualConsumption({
      readings: [r("2024-03-01T00:00:00Z", 500)],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2024-07-01T00:00:00Z"),
    });
    expect(result.projectedAnnual).toBeNull();
    expect(result.previousYearConsumption).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.deltaConsumptionPct).toBeNull();
  });

  it("liefert null-Hochrechnung ganz ohne Ablesungen", () => {
    const result = projectAnnualConsumption({
      readings: [],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2024-07-01T00:00:00Z"),
    });
    expect(result.projectedAnnual).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("rechnet nicht in die Zukunft, wenn die jüngste Ablesung in der Zukunft datiert ist", () => {
    // Anker wird auf „jetzt" begrenzt.
    const result = projectAnnualConsumption({
      readings: [r("2024-01-01T00:00:00Z", 0), r("2999-01-01T00:00:00Z", 5000)],
      kategorie: "STROM",
      einheit: "kWh",
      now: new Date("2024-07-01T00:00:00Z"),
    });
    expect(new Date(result.anchorDate).getTime()).toBeLessThanOrEqual(
      new Date("2024-07-01T00:00:00Z").getTime(),
    );
  });
});

describe("projectAnnualConsumption — saisonale Gewichtung", () => {
  it("wählt für GAS automatisch das saisonale Verfahren und gewichtet Winterdaten ab", () => {
    // Winterlastige Teilstrecke, beide Verfahren auf dieselben Daten.
    const readings = [r("2024-01-01T00:00:00Z", 0), r("2024-02-01T00:00:00Z", 310)];
    const now = new Date("2024-02-01T00:00:00Z");

    const seasonal = projectAnnualConsumption({ readings, kategorie: "GAS", einheit: "m³", now });
    const linear = projectAnnualConsumption({
      readings,
      kategorie: "GAS",
      einheit: "m³",
      method: "linear",
      now,
    });

    expect(seasonal.method).toBe("seasonal");
    expect(linear.method).toBe("linear");
    expect(seasonal.projectedAnnual).not.toBeNull();
    // Winter ist im Profil überdurchschnittlich → die saisonale Jahresschätzung
    // fällt niedriger aus als die lineare, die jeden Monat wie den Januar annimmt.
    expect(seasonal.projectedAnnual!).toBeLessThan(linear.projectedAnnual!);
  });

  it("rechnet den Verbrauch über einen Zählertausch hinweg korrekt hoch", () => {
    // Letzte richtige Ablesung 09/2023, Tausch 03/2024 (alt 1120, neu 0),
    // neue Ablesung 09/2024 = 95. Das gleitende Jahr bis 09/2024 muss BEIDE
    // Teilstrecken sehen (Alt: 1000→1120, Neu: 0→95).
    const readings: ConsumptionInputReading[] = [
      r("2023-09-05T00:00:00Z", 1000),
      { id: "swap", datum: new Date("2024-03-05T00:00:00Z"), wert: 1120, zaehlerGetauscht: true, startwertNeu: 0 },
      r("2024-09-05T00:00:00Z", 95),
    ];
    const result = projectAnnualConsumption({
      readings,
      kategorie: "WASSER",
      einheit: "m³",
      method: "linear",
      now: new Date("2024-09-05T00:00:00Z"),
    });
    // 120 (alt) + 95 (neu) = 215, über ~366 Tage → auf 365 normiert ≈ 214.
    expect(result.projectedAnnual!).toBeGreaterThan(213);
    expect(result.projectedAnnual!).toBeLessThan(216);
  });
});
