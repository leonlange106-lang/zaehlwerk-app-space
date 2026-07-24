import { describe, expect, it } from "vitest";
import { buildYearlyReport, type ReportZaehlerInput } from "./report-model";

// Regression tests for the yearly overview around a meter swap.
//
// The reported defect: in the printed report every section lost the reading
// that FOLLOWED a Zählertausch — the cell was blank and the row's "Gesamt"
// disappeared with it. Cause was the swap baseline in `calculateConsumption`
// being applied to the swap's own interval instead of the next one, which both
// inflated the swap interval to the old meter's absolute reading and made the
// following interval negative (→ "unplausibel" → dropped).
//
// The meter here mirrors the water meter around the 31.03.2005 swap in the
// user's original printout.

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const TARIFF = {
  gueltigAb: d("2000-01-01"),
  gueltigBis: null,
  arbeitspreisCtNetto: 300,
  grundpreisJahrNetto: 60,
  mwstProzent: 19,
};

/**
 * `startwertNeu: null` on purpose — the CSV importer only ever sets the swap
 * flag, so this is the shape most real historical data actually has.
 */
function waterMeter(startwertNeu: number | null = null): ReportZaehlerInput {
  return {
    id: "w",
    name: "Wasser",
    kategorie: "WASSER",
    einheit: "m³",
    tarife: [TARIFF],
    ablesungen: [
      { id: "r1", datum: d("2004-09-11"), wert: 1000, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
      // Swap: the old meter ends at 1120, the replacement starts at `startwertNeu`.
      { id: "r2", datum: d("2005-03-31"), wert: 1120, zaehlerGetauscht: true, startwertNeu, kosten: null },
      { id: "r3", datum: d("2005-09-15"), wert: 95, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
      { id: "r4", datum: d("2006-09-19"), wert: 190, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
    ],
  };
}

function cellsByDate(meter: ReportZaehlerInput) {
  const report = buildYearlyReport([meter]);
  return new Map(report.rows.map((row) => [row.date, row.wasser]));
}

describe("buildYearlyReport – Zählertausch", () => {
  it("faltet die Tausch-Strecke in das volle Jahr der Folge-Ablesung", () => {
    const cells = cellsByDate(waterMeter());
    const after = cells.get("2005-09-15");

    // Jahresverbrauch = letzte richtige Ablesung (1000) → Endstand alt (1120)
    // PLUS Startwert neu (0) → neue Ablesung (95) = 120 + 95 = 215.
    expect(after?.consumption).toBe(215);
    // Und über den vollen Zeitraum 11.09.2004 → 15.09.2005 (≈ 369 Tage), nicht
    // nur die halbe Strecke seit dem Tausch.
    expect(after?.days).toBe(369);
    expect(after?.cost).not.toBeNull();
    expect(after?.swap).toBe(false);
  });

  it("zeigt die Tausch-Ablesung nur als Markierung, ohne eigene Jahreszahl", () => {
    const cells = cellsByDate(waterMeter());
    const swap = cells.get("2005-03-31");

    expect(swap?.swap).toBe(true);
    expect(swap?.consumption).toBeNull();
    expect(swap?.cost).toBeNull();
  });

  it("berücksichtigt einen erfassten Startwert des neuen Zählers", () => {
    const cells = cellsByDate(waterMeter(5));
    // 120 (alt) + (95 − 5) (neu) = 210.
    expect(cells.get("2005-09-15")?.consumption).toBe(210);
    expect(cells.get("2005-03-31")?.swap).toBe(true);
  });

  it("verliert durch den Tausch keinen Verbrauch aus der Gesamtsumme", () => {
    // Summe der ausgewiesenen Jahreszeilen (die Markierung zählt nicht):
    // 2005 = 215, 2006 = 95. Nichts fällt weg.
    const cells = cellsByDate(waterMeter());
    const yearly = [...cells.values()]
      .filter((c): c is NonNullable<typeof c> => c !== null && !c.swap)
      .map((c) => c.consumption);
    // Einbau-Stand (1000), 2005 gefaltet (215), 2006 (95).
    expect(yearly).toEqual([1000, 215, 95]);
  });

  it("markiert eine Jahreszeile nur dann als unplausibel, wenn sie es wirklich ist", () => {
    const report = buildYearlyReport([waterMeter()]);
    // Tausch-Markierungen (consumption null) dürfen NICHT als unplausible
    // Jahreszeilen zählen.
    const implausibleYears = report.rows.filter(
      (row) => row.wasser && !row.wasser.swap && row.wasser.consumption === null,
    );
    expect(implausibleYears).toEqual([]);
  });

  it("hält die Folgejahre unverändert", () => {
    const cells = cellsByDate(waterMeter());
    expect(cells.get("2006-09-19")?.consumption).toBe(95); // 190 − 95
  });
});

describe("buildYearlyReport – Erst-Ablesung (Installations-Stand)", () => {
  function stromMeter() {
    return {
      id: "s",
      name: "Strom",
      kategorie: "STROM" as const,
      einheit: "kWh",
      tarife: [],
      ablesungen: [
        { id: "a", datum: d("2000-05-31"), wert: 48, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
        { id: "b", datum: d("2000-09-16"), wert: 1180, zaehlerGetauscht: false, startwertNeu: null, kosten: 327.4 },
      ],
    };
  }

  it("führt die erste Ablesung als Verbrauch seit Einbau (Stand ab 0), mit 0 Tagen", () => {
    const report = buildYearlyReport([stromMeter()]);
    const first = report.rows.find((r) => r.date === "2000-05-31")?.strom;
    expect(first?.consumption).toBe(48); // 48 − 0
    expect(first?.days).toBe(0); // kein Vorintervall → keine Rate/Kosten
    expect(first?.swap).toBe(false);
  });

  it("rechnet die zweite Ablesung normal gegen die erste", () => {
    const report = buildYearlyReport([stromMeter()]);
    expect(report.rows.find((r) => r.date === "2000-09-16")?.strom?.consumption).toBe(1132);
  });

  it("weist Gas den Einbau-Verbrauch auch in kWh aus", () => {
    const gas = {
      id: "g",
      name: "Gas",
      kategorie: "GAS" as const,
      einheit: "m³",
      tarife: [],
      ablesungen: [
        { id: "a", datum: d("2000-05-31"), wert: 85, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
        { id: "b", datum: d("2000-09-16"), wert: 649, zaehlerGetauscht: false, startwertNeu: null, kosten: null },
      ],
    };
    const first = buildYearlyReport([gas]).rows.find((r) => r.date === "2000-05-31")?.gas;
    expect(first?.consumption).toBe(85);
    // 85 m³ × Brennwert × Zustandszahl ≈ 843 kWh (Referenz-Bericht).
    expect(Math.round(first!.consumptionKwh!)).toBe(843);
  });
});
