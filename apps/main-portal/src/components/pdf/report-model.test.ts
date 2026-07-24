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
  it("weist die Ablesung nach dem Tausch mit Verbrauch UND Kosten aus", () => {
    const cells = cellsByDate(waterMeter());
    const after = cells.get("2005-09-15");

    // Der neue Zähler lief von 0 auf 95.
    expect(after?.consumption).toBe(95);
    expect(after?.cost).not.toBeNull();
    expect(after?.swap).toBe(false);
  });

  it("bucht auf die Tausch-Ablesung nur den Verbrauch des ALTEN Geräts", () => {
    const cells = cellsByDate(waterMeter());
    const swap = cells.get("2005-03-31");

    // 1120 − 1000, nicht der komplette Endstand 1120: Letzteres hat früher jede
    // Gesamtsumme und jede Hochrechnung des Zählers verfälscht.
    expect(swap?.consumption).toBe(120);
    expect(swap?.swap).toBe(true);
  });

  it("berücksichtigt einen erfassten Startwert des neuen Zählers", () => {
    const cells = cellsByDate(waterMeter(5));
    expect(cells.get("2005-09-15")?.consumption).toBe(90); // 95 − 5
    expect(cells.get("2005-03-31")?.consumption).toBe(120); // unverändert
  });

  it("lässt kein Intervall unplausibel werden, nur weil getauscht wurde", () => {
    const report = buildYearlyReport([waterMeter()]);
    const implausible = report.rows.filter((row) => row.wasser && row.wasser.consumption === null);
    expect(implausible).toEqual([]);
  });

  it("hält die Folgejahre unverändert", () => {
    const cells = cellsByDate(waterMeter());
    expect(cells.get("2006-09-19")?.consumption).toBe(95); // 190 − 95
  });
});
