import { describe, expect, it } from "vitest";
import { pickBoostActual } from "./channels";
import { parseLog } from "./log-parser";
import type { LogSeries } from "./types";

// Welche Spalte der Ladedruck IST, war an zwei Orten beantwortet — und die
// Antworten liefen auseinander. Der Parser fiel mangels "actual"/"ist" im
// Spaltennamen auf die erste Spalte mit "Boost" zurück, und bei MGflasher heißt
// die `Boost Pressure: Ambient`. Die Kennzahl "Peak Boost" zeigte damit den
// Umgebungsdruck: 992 hPa statt 1264. Plausibel genug, um lange durchzugehen.

/** Kopfzeile eines MGflasher-Logs, in der Reihenfolge, in der sie wirklich kommt. */
const MGFLASHER_HEADER = [
  "Time [s]",
  "RPM",
  "Boost Pressure: Ambient [hPa]",
  "Boost Pressure: Intake Manifold [hPa]",
  "Boost Pressure: Pre-Throttle Body [hPa]",
  "Boost Pressure: Target [hPa]",
  "Boost: Charge Factor Ratio",
  "Boost: MAF Corrected [kg/h]",
];

function csv(rows: number[][]): string {
  return [MGFLASHER_HEADER.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function seriesOf(source: string): LogSeries[] {
  return parseLog(source).series;
}

describe("pickBoostActual", () => {
  it("wählt den Ladedruck, nicht den Umgebungsdruck", () => {
    // Die Ambient-Spalte steht VOR der Ansaugkrümmer-Spalte. Genau darauf ist
    // der alte Fehler hereingefallen: erste Übereinstimmung gewinnt.
    const series = seriesOf(
      csv([
        [0, 900, 991, 300, 320, 310, 1, 100],
        [1, 5000, 991, 1264, 1593, 1281, 2, 900],
      ]),
    );
    const boost = pickBoostActual(series);
    expect(boost?.label).toContain("Intake Manifold");
    expect(boost?.max).toBe(1264);
  });

  it("liefert dieselbe Spalte wie die Kennzahl im Parser", () => {
    // Die eigentliche Zusicherung: EINE Quelle für diese Frage. Weichen die
    // beiden je wieder ab, ist genau das der Fehler, der hier gefangen wird.
    const source = csv([
      [0, 900, 991, 300, 320, 310, 1, 100],
      [1, 5000, 991, 1264, 1593, 1281, 2, 900],
    ]);
    const parsed = parseLog(source);
    expect(parsed.meta.peakBoost).toBe(pickBoostActual(parsed.series)?.max);
    expect(parsed.meta.peakBoost).toBe(1264);
  });

  it("bevorzugt eine ausdrücklich als Ist benannte Spalte", () => {
    // Werkzeuge, die "Boost Actual" schreiben, sollen weiterhin gewinnen —
    // auch wenn eine Ansaugkrümmer-Spalte daneben steht.
    const header = ["Time [s]", "Boost Pressure: Ambient [hPa]", "Intake Manifold [hPa]", "Boost Actual [psi]"];
    const parsed = parseLog([header.join(","), "0,991,1264,18"].join("\n"));
    expect(pickBoostActual(parsed.series)?.label).toContain("Boost Actual");
  });

  it("nimmt niemals den Stellwert der Ladedruckregelung", () => {
    // "Boost Control Duty" ist ein Prozentwert, kein Druck. Als Ladedruck
    // ausgewiesen waere er sinnlos und wuerde zudem die Grenzwertpruefung
    // gegen eine voellig andere Groesse laufen lassen.
    const header = ["Time [s]", "Boost Control Duty [%]", "Intake Manifold [hPa]"];
    const parsed = parseLog([header.join(","), "0,45,1264"].join("\n"));
    expect(pickBoostActual(parsed.series)?.label).toContain("Intake Manifold");
  });

  it("gibt null zurück, wenn es keine Druckspalte gibt", () => {
    const parsed = parseLog(["Time [s],RPM", "0,900"].join("\n"));
    expect(pickBoostActual(parsed.series)).toBeNull();
  });
});
