import { describe, expect, it } from "vitest";
import { parseLog } from "./log-parser";

// All fixtures below are SYNTHETIC — no real vehicle data or share links.

const COMMA_LOG = [
  "# VIN: WBSSYNTH0TEST1234",
  "# Vehicle: Synthetic Coupe",
  "# Map: Stage2 v1.3",
  "# Date: 2024-05-01 12:00",
  "Time (s),RPM,Boost Actual (psi),Boost Target (psi),Ignition Timing (deg),Gear",
  "0.0,820,0.1,0.2,12.5,1",
  "0.1,3200,8.4,9.0,6.0,2",
  "0.2,6100,18.9,19.2,3.5,3",
  "0.3,6800,17.2,18.0,4.0,4",
].join("\n");

describe("parseLog — happy path (comma-delimited, metadata block)", () => {
  const log = parseLog(COMMA_LOG);

  it("reads the metadata header block", () => {
    expect(log.meta.vin).toBe("WBSSYNTH0TEST1234");
    expect(log.meta.vehicle).toBe("Synthetic Coupe");
    expect(log.meta.mapVersion).toBe("Stage2 v1.3");
    expect(log.meta.date).toBe("2024-05-01 12:00");
  });

  it("uses the time column as the x-axis (seconds)", () => {
    expect(log.timeUnit).toBe("s");
    expect(log.time).toEqual([0.0, 0.1, 0.2, 0.3]);
    expect(log.rowCount).toBe(4);
    expect(log.skippedRows).toBe(0);
  });

  it("does not create a series for the time column", () => {
    expect(log.series.some((s) => /time/i.test(s.label))).toBe(false);
    expect(log.series.map((s) => s.label)).toContain("RPM");
  });

  it("splits units out of the header", () => {
    const boost = log.series.find((s) => s.label === "Boost Actual");
    expect(boost).toBeDefined();
    expect(boost!.unit).toBe("psi");
    expect(boost!.values).toEqual([0.1, 8.4, 18.9, 17.2]);
  });

  it("assigns channels to logical groups", () => {
    const groups = Object.fromEntries(log.series.map((s) => [s.label, s.group]));
    expect(groups["RPM"]).toBe("Engine & Drivetrain");
    expect(groups["Boost Actual"]).toBe("Boost Control");
    expect(groups["Ignition Timing"]).toBe("Ignition & Knock");
  });

  it("computes highlight metadata from the channels", () => {
    expect(log.meta.maxRpm).toBe(6800);
    expect(log.meta.peakBoost).toBe(18.9);
    expect(log.meta.peakBoostUnit).toBe("psi");
    expect(log.meta.gearRange).toEqual([1, 4]);
    expect(log.meta.duration).toBeCloseTo(0.3, 5);
  });
});

describe("parseLog — delimiter and decimal variants", () => {
  it("auto-detects a semicolon delimiter with German decimal commas", () => {
    const csv = ["Zeit;Drehzahl;Ladedruck", "0;1000;0,5", "1;5000;12,3"].join("\n");
    const log = parseLog(csv);
    expect(log.time).toEqual([0, 1]);
    const boost = log.series.find((s) => s.label === "Ladedruck");
    expect(boost!.values).toEqual([0.5, 12.3]);
  });

  it("auto-detects a tab delimiter", () => {
    const csv = ["Time\tRPM\tIAT", "0\t900\t22", "1\t4200\t35"].join("\n");
    const log = parseLog(csv);
    expect(log.series.map((s) => s.label)).toEqual(["RPM", "IAT"]);
    expect(log.series[0].values).toEqual([900, 4200]);
  });
});

describe("parseLog — resilience", () => {
  it("skips corrupt rows (wrong column count) but keeps the good ones", () => {
    const csv = [
      "Time,RPM,Boost",
      "0,1000,1.0",
      "1,GARBAGE_LINE_WITHOUT_ENOUGH_COLUMNS",
      "2,3000,5.5",
      "3,4000,6.0,extra,columns,here",
    ].join("\n");
    const log = parseLog(csv);
    expect(log.rowCount).toBe(2);
    expect(log.skippedRows).toBe(2);
    expect(log.time).toEqual([0, 2]);
  });

  it("skips rows whose time cell is not numeric", () => {
    const csv = ["Time,RPM", "0,1000", "not-a-number,2000", "2,3000"].join("\n");
    const log = parseLog(csv);
    expect(log.rowCount).toBe(2);
    expect(log.skippedRows).toBe(1);
  });

  it("records gaps (null) for empty cells without dropping the row", () => {
    const csv = ["Time,RPM,Boost", "0,1000,", "1,,5.5"].join("\n");
    const log = parseLog(csv);
    const rpm = log.series.find((s) => s.label === "RPM")!;
    const boost = log.series.find((s) => s.label === "Boost")!;
    expect(rpm.values).toEqual([1000, null]);
    expect(boost.values).toEqual([null, 5.5]);
    expect(log.rowCount).toBe(2);
  });

  it("drops columns that never carry a number", () => {
    const csv = ["Time,RPM,Note", "0,1000,idle", "1,2000,pull"].join("\n");
    const log = parseLog(csv);
    expect(log.series.map((s) => s.label)).toEqual(["RPM"]);
  });

  it("synthesizes a sample index when no time column exists", () => {
    const csv = ["RPM,Boost", "1000,1.0", "2000,2.0", "3000,3.0"].join("\n");
    const log = parseLog(csv);
    expect(log.timeUnit).toBe("#");
    expect(log.time).toEqual([0, 1, 2]);
    expect(log.meta.duration).toBeNull();
  });

  it("throws when there is no header at all", () => {
    expect(() => parseLog("\n\n   \n")).toThrow();
  });

  it("throws when the header has too few columns", () => {
    expect(() => parseLog("JustOneColumn\n1\n2")).toThrow();
  });

  it("keeps series keys unique when labels collide", () => {
    const csv = ["Time,RPM,RPM", "0,1,2", "1,3,4"].join("\n");
    const log = parseLog(csv);
    const keys = log.series.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
