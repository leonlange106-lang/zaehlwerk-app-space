import { describe, expect, it } from "vitest";
import {
  airflowFromSpeedDensity,
  ambientFor,
  buildDynoChartRows,
  correctionFactor,
  estimateDyno,
  kwToPs,
  powerFromAirflowKw,
  toGramsPerSecond,
  toHectoPascal,
  toMetersPerSecond,
  torqueNm,
} from "./dyno-engine";
import { resolveChannels } from "./channels";
import { DEFAULT_DYNO_PROFILE, tireCircumferenceM, totalRatioFor, type DynoProfile } from "./dyno-spec";
import { coerceDynoProfile } from "./dyno-store";
import { parseLog } from "./log-parser";
import { makeSampleCsv } from "./sample-log";
import { makeLog, type ColumnSpec } from "./test-helpers";

// SYNTHETIC fixtures only — no real vehicle data.

const PROFILE: DynoProfile = { ...DEFAULT_DYNO_PROFILE };

/**
 * A clean 3rd-gear WOT pull, 2000 → 7000 rpm over 5 s, with the channels the
 * caller asks for. `mafGs` / `boostBar` are evaluated per sample so a test can
 * shape the curve it wants.
 */
function pullLog(opts: {
  samples?: number;
  seconds?: number;
  maf?: (progress: number, rpm: number) => number;
  boostBar?: (progress: number) => number;
  iatC?: number;
  speedKmh?: (progress: number, t: number) => number;
  ambientHpa?: number;
  ambientC?: number;
}) {
  const n = opts.samples ?? 60;
  const seconds = opts.seconds ?? 5;
  const time: number[] = [];
  const rpm: number[] = [];
  const pedal: number[] = [];
  const gear: number[] = [];
  const maf: number[] = [];
  const boost: number[] = [];
  const iat: number[] = [];
  const speed: number[] = [];
  const ambientP: number[] = [];
  const ambientT: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const p = i / (n - 1);
    const t = p * seconds;
    const r = 2000 + p * 5000;
    time.push(+t.toFixed(4));
    rpm.push(Math.round(r));
    pedal.push(100);
    gear.push(3);
    if (opts.maf) maf.push(+opts.maf(p, r).toFixed(3));
    if (opts.boostBar) boost.push(+opts.boostBar(p).toFixed(4));
    iat.push(opts.iatC ?? 30);
    if (opts.speedKmh) speed.push(+opts.speedKmh(p, t).toFixed(3));
    if (opts.ambientHpa !== undefined) ambientP.push(opts.ambientHpa);
    if (opts.ambientC !== undefined) ambientT.push(opts.ambientC);
  }

  const columns: ColumnSpec[] = [
    { label: "RPM", values: rpm },
    { label: "Pedal", unit: "%", values: pedal },
    { label: "Gear", values: gear },
    { label: "IAT", unit: "°C", values: iat },
  ];
  if (opts.maf) columns.push({ label: "MAF", unit: "g/s", values: maf });
  if (opts.boostBar) columns.push({ label: "Boost Actual", unit: "bar", values: boost });
  if (opts.speedKmh) columns.push({ label: "Vehicle Speed", unit: "km/h", values: speed });
  if (opts.ambientHpa !== undefined) columns.push({ label: "Ambient Pressure", unit: "hPa", values: ambientP });
  if (opts.ambientC !== undefined) columns.push({ label: "Ambient Temp", unit: "°C", values: ambientT });

  return makeLog(columns, time);
}

describe("unit conversions", () => {
  it("normalises mass air flow to g/s across the common log units", () => {
    expect(toGramsPerSecond(100, "g/s")).toBeCloseTo(100, 6);
    expect(toGramsPerSecond(360, "kg/h")).toBeCloseTo(100, 6);
    expect(toGramsPerSecond(10, "lb/min")).toBeCloseTo(75.5987, 3);
    // Unit-less falls back to the MGflasher default (g/s).
    expect(toGramsPerSecond(250, null)).toBe(250);
  });

  it("normalises road speed to m/s", () => {
    expect(toMetersPerSecond(36, "km/h")).toBeCloseTo(10, 6);
    expect(toMetersPerSecond(10, "m/s")).toBeCloseTo(10, 6);
    expect(toMetersPerSecond(60, "mph")).toBeCloseTo(26.8224, 4);
  });

  it("normalises pressure to hPa, using magnitude when the unit is missing", () => {
    expect(toHectoPascal(1013, "hPa")).toBe(1013);
    expect(toHectoPascal(101.3, "kPa")).toBeCloseTo(1013, 6);
    expect(toHectoPascal(1.013, "bar")).toBeCloseTo(1013, 6);
    expect(toHectoPascal(1.0, null)).toBeCloseTo(1000, 6);
    expect(toHectoPascal(99, null)).toBeCloseTo(990, 6);
    expect(toHectoPascal(985, null)).toBe(985);
  });
});

describe("dyno maths", () => {
  it("converts air mass to power at the configured efficiency offset", () => {
    // 0.8 g/s per hp → 100 g/s = 125 hp = 93.2 kW ≈ 126.7 PS.
    const kw = powerFromAirflowKw(100, 0.8);
    expect(kw).toBeCloseTo(93.21, 2);
    expect(kwToPs(kw)).toBeCloseTo(126.73, 2);
    // A richer / less efficient map needs more air for the same power.
    expect(powerFromAirflowKw(100, 0.9)).toBeLessThan(kw);
  });

  it("relates power, torque and engine speed", () => {
    // 300 Nm at 5000 rpm ≈ 157 kW.
    expect(torqueNm(157.06, 5000)).toBeCloseTo(300, 0);
    expect(torqueNm(100, 0)).toBe(0);
  });

  it("estimates airflow from the speed-density model", () => {
    // 3.0 L at 6000 rpm, 200 kPa absolute, 30 °C, VE 0.95:
    // ρ = 200000 / (287.058 · 303.15) = 2.299 kg/m³
    // V̇ = 0.003 · 3000 / 60 = 0.15 m³/s → 2.299 · 0.15 · 0.95 · 1000 ≈ 327 g/s
    const gs = airflowFromSpeedDensity(200, 30, 6000, 3.0, 0.95);
    expect(gs).toBeCloseTo(327.6, 0);
    // More boost and colder charge ⇒ denser mixture ⇒ more air.
    expect(airflowFromSpeedDensity(250, 30, 6000, 3.0, 0.95)).toBeGreaterThan(gs);
    expect(airflowFromSpeedDensity(200, 10, 6000, 3.0, 0.95)).toBeGreaterThan(gs);
    expect(airflowFromSpeedDensity(200, 30, 0, 3.0, 0.95)).toBe(0);
  });
});

describe("atmospheric correction factors", () => {
  it("is exactly 1 at each standard's reference conditions", () => {
    expect(correctionFactor("sae", 990, 25)).toBeCloseTo(1, 6);
    expect(correctionFactor("din", 1013, 20)).toBeCloseTo(1, 6);
  });

  it("returns 1 and never scales the curve when correction is off", () => {
    expect(correctionFactor("none", 900, 40)).toBe(1);
  });

  it("corrects power UP in thin (high-altitude) or hot air", () => {
    expect(correctionFactor("sae", 950, 25)).toBeGreaterThan(1);
    expect(correctionFactor("din", 950, 20)).toBeGreaterThan(1);
    expect(correctionFactor("sae", 990, 35)).toBeGreaterThan(1);
    expect(correctionFactor("din", 1013, 35)).toBeGreaterThan(1);
  });

  it("corrects power DOWN in dense (cold, high-pressure) air", () => {
    expect(correctionFactor("sae", 1030, 5)).toBeLessThan(1);
    expect(correctionFactor("din", 1030, 5)).toBeLessThan(1);
  });

  it("clamps an implausible pressure instead of scaling the curve absurdly", () => {
    expect(correctionFactor("din", 1, 20)).toBe(1.2);
    expect(correctionFactor("din", 100000, 20)).toBe(0.8);
    expect(correctionFactor("din", 0, 20)).toBe(1);
    expect(correctionFactor("sae", Number.NaN, 20)).toBe(1);
  });

  it("reads ambient conditions from the log when present, else uses the standard", () => {
    const withAmbient = pullLog({ maf: () => 200, ambientHpa: 950, ambientC: 32 });
    const chA = resolveChannels(withAmbient);
    const a = ambientFor(chA, 0, withAmbient.time.length - 1);
    expect(a.pressureHpa).toBeCloseTo(950, 6);
    expect(a.tempC).toBeCloseTo(32, 6);
    expect(a.pressureFromLog).toBe(true);

    const bare = pullLog({ maf: () => 200 });
    const b = ambientFor(resolveChannels(bare), 0, bare.time.length - 1);
    expect(b.pressureHpa).toBe(1013);
    expect(b.tempC).toBe(20);
    expect(b.pressureFromLog).toBe(false);
    expect(b.tempFromLog).toBe(false);
  });
});

describe("estimateDyno — air-mass method", () => {
  // Airflow rising to 300 g/s at 6000 rpm, tapering to redline: a realistic
  // shape whose torque peaks well before its power peak.
  const maf = (p: number) => 60 + 240 * Math.min(1, p * 1.6) - Math.max(0, p - 0.8) * 100;

  it("builds a curve from a logged MAF trace and reports the peaks", () => {
    const log = pullLog({ maf });
    const result = estimateDyno(log, PROFILE);
    expect(result.primary).not.toBeNull();
    const curve = result.primary!;
    expect(curve.method).toBe("airmass");
    expect(curve.source).toMatch(/MAF/);
    expect(curve.points.length).toBeGreaterThanOrEqual(4);
    // 300 g/s at 0.8 g/s per hp ≈ 375 hp ≈ 380 PS at the crank.
    expect(curve.peakPower!.crankPs).toBeGreaterThan(300);
    expect(curve.peakPower!.crankPs).toBeLessThan(420);
    // Peak torque comes at a lower engine speed than peak power.
    expect(curve.peakTorque!.rpm).toBeLessThan(curve.peakPower!.rpm);
    // The X axis is monotone rising, as a dyno plot must be.
    const rpms = curve.points.map((p) => p.rpm);
    expect([...rpms].sort((a, b) => a - b)).toEqual(rpms);
  });

  it("reports wheel power below crank power by exactly the drivetrain loss", () => {
    const log = pullLog({ maf });
    const curve = estimateDyno(log, { ...PROFILE, drivetrainLossPct: 15 }).primary!;
    const peak = curve.peakPower!;
    expect(peak.wheelPs).toBeCloseTo(peak.crankPs * 0.85, 6);
    expect(peak.wheelNm).toBeCloseTo(peak.crankNm * 0.85, 6);
    // Torque and power stay consistent with each other at every point.
    for (const p of curve.points) {
      expect(p.crankNm).toBeCloseTo(torqueNm(p.crankKw, p.rpm), 6);
    }
  });

  it("falls back to the VE/speed-density model when no MAF is logged", () => {
    const log = pullLog({ boostBar: (p) => Math.min(1, p * 2.5) * 1.4 });
    const result = estimateDyno(log, PROFILE);
    expect(result.primary?.method).toBe("airmass");
    expect(result.primary?.source).toMatch(/Speed-Density/);
    expect(result.primary!.peakPower!.crankPs).toBeGreaterThan(100);
    expect(result.notes.join(" ")).toMatch(/VE-Modell/);
  });

  it("scales the whole curve by the applied correction factor", () => {
    const log = pullLog({ maf, ambientHpa: 950, ambientC: 30 });
    const raw = estimateDyno(log, PROFILE, { correction: "none" }).primary!;
    const din = estimateDyno(log, PROFILE, { correction: "din" }).primary!;
    expect(raw.correctionFactor).toBe(1);
    expect(din.correctionFactor).toBeGreaterThan(1);
    expect(din.peakPower!.crankPs).toBeCloseTo(raw.peakPower!.crankPs * din.correctionFactor, 6);
    // The two standards disagree slightly — that is the point of the toggle.
    const sae = estimateDyno(log, PROFILE, { correction: "sae" }).primary!;
    expect(sae.correctionFactor).not.toBeCloseTo(din.correctionFactor, 4);
  });

  it("makes more power from the same air when the efficiency offset drops", () => {
    const log = pullLog({ maf });
    const lean = estimateDyno(log, { ...PROFILE, gramsPerHp: 0.75 }).primary!;
    const rich = estimateDyno(log, { ...PROFILE, gramsPerHp: 0.85 }).primary!;
    expect(lean.peakPower!.crankPs).toBeGreaterThan(rich.peakPower!.crankPs);
  });
});

describe("estimateDyno — acceleration fallback", () => {
  // 1st-order kinematics: constant 5 m/s² from 20 m/s, logged in km/h.
  const speedKmh = (_p: number, t: number) => (20 + 5 * t) * 3.6;

  it("derives a curve from vehicle speed when no airflow channel exists", () => {
    const log = pullLog({ speedKmh });
    const result = estimateDyno(log, PROFILE);
    expect(result.primary?.method).toBe("acceleration");
    expect(result.primary?.source).toMatch(/Fahrzeuggeschwindigkeit/);
    expect(result.primary!.peakPower!.crankPs).toBeGreaterThan(0);
  });

  it("follows F = m·a: twice the mass is roughly twice the power", () => {
    const log = pullLog({ speedKmh });
    const light = estimateDyno(log, { ...PROFILE, massKg: 1000 }).primary!;
    const heavy = estimateDyno(log, { ...PROFILE, massKg: 2000 }).primary!;
    const ratio = heavy.peakPower!.crankKw / light.peakPower!.crankKw;
    // Not exactly 2: drag does not scale with mass, rolling resistance does.
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.1);
  });

  it("matches the closed-form power at a known point", () => {
    // At v = 30 m/s with a = 5 m/s², m = 1500 kg (×1.06 rotating), Cd·A as
    // configured: F = 1590·5 + ½·ρ·0.31·2.16·900 + 0.012·1500·9.807 ≈ 8422 N
    // → P_wheel ≈ 252.7 kW → crank ≈ 297 kW at 15 % loss.
    const log = pullLog({ speedKmh, samples: 120, seconds: 5 });
    const curve = estimateDyno(log, { ...PROFILE, massKg: 1500 }).primary!;
    // v = 30 m/s is reached at t = 2 s → 40 % into a 2000→7000 sweep = 4000 rpm.
    const at4000 = curve.points.find((p) => p.rpm === 4000)!;
    expect(at4000.crankKw).toBeGreaterThan(280);
    expect(at4000.crankKw).toBeLessThan(315);
  });

  it("derives road speed from the gearing when no speed channel is logged", () => {
    const log = pullLog({ boostBar: (p) => Math.min(1, p * 2.5) * 1.4 });
    const result = estimateDyno(log, PROFILE, { method: "acceleration" });
    expect(result.primary?.method).toBe("acceleration");
    expect(result.primary?.source).toMatch(/Aus Drehzahl · Gang 3/);
    // The air-mass curve is still available as the cross-check.
    expect(result.crossCheck?.method).toBe("airmass");
  });

  it("cannot differentiate a synthetic (index) time axis", () => {
    const log = makeLog([
      { label: "RPM", values: Array.from({ length: 40 }, (_, i) => 2000 + i * 125) },
      { label: "Pedal", unit: "%", values: new Array(40).fill(100) },
      { label: "Gear", values: new Array(40).fill(3) },
      { label: "Vehicle Speed", unit: "km/h", values: Array.from({ length: 40 }, (_, i) => 60 + i * 2) },
    ]);
    const result = estimateDyno(log, PROFILE);
    expect(result.primary).toBeNull();
    expect(result.notes.join(" ")).toMatch(/Zeitachse/);
  });
});

describe("estimateDyno — degenerate logs", () => {
  it("returns no curve and an explanation when the log has no RPM channel", () => {
    const log = makeLog([{ label: "Boost Actual", unit: "bar", values: [0.5, 1, 1.2] }]);
    const result = estimateDyno(log, PROFILE);
    expect(result.primary).toBeNull();
    expect(result.crossCheck).toBeNull();
    expect(result.notes[0]).toMatch(/Drehzahl/);
  });

  it("returns no curve for a pull window that is too short", () => {
    const log = makeLog(
      [
        { label: "RPM", values: [3000, 4000, 5000] },
        { label: "Pedal", unit: "%", values: [100, 100, 100] },
        { label: "MAF", unit: "g/s", values: [200, 250, 300] },
      ],
      [0, 0.1, 0.2],
    );
    const result = estimateDyno(log, PROFILE);
    expect(result.primary).toBeNull();
    expect(result.notes.join(" ")).toMatch(/zu kurz/);
  });

  it("flags an RPM-derived (non-pedal) pull window as approximate", () => {
    const log = pullLog({ maf: () => 200 });
    // Strip the pedal channel: the detector falls back to the RPM sweep.
    const stripped = { ...log, series: log.series.filter((s) => s.label !== "Pedal") };
    const result = estimateDyno(stripped, PROFILE);
    expect(result.pedalDriven).toBe(false);
    expect(result.notes.join(" ")).toMatch(/Näherung/);
  });
});

describe("estimateDyno — end to end over the parsed sample log", () => {
  it("produces a plausible dyno sheet from the shipped sample CSV", () => {
    const log = parseLog(makeSampleCsv());
    const result = estimateDyno(log, DEFAULT_DYNO_PROFILE, { correction: "din" });
    const curve = result.primary!;
    // No MAF in the sample → the VE model carries it, with the RPM-derived
    // acceleration curve as the cross-check.
    expect(curve.method).toBe("airmass");
    expect(result.crossCheck?.method).toBe("acceleration");
    expect(result.pedalDriven).toBe(true);

    // The pull sweeps to the sample's 7000 rpm redline and the curve has the
    // shape of a turbo engine: torque plateau early, power peak at the top.
    expect(curve.peakPower!.rpm).toBeGreaterThan(6000);
    expect(curve.peakTorque!.rpm).toBeLessThan(curve.peakPower!.rpm);
    expect(curve.peakTorque!.crankNm).toBeGreaterThan(curve.peakPower!.crankNm);
    expect(curve.points.every((p) => p.crankPs > 0 && p.crankNm > 0)).toBe(true);
  });
});

describe("buildDynoChartRows", () => {
  it("merges both curves onto one rpm grid and reports the selected output side", () => {
    const log = pullLog({ maf: (p) => 60 + 240 * Math.min(1, p * 1.6), speedKmh: (_p, t) => (20 + 5 * t) * 3.6 });
    const estimate = estimateDyno(log, PROFILE);
    expect(estimate.primary?.method).toBe("airmass");
    expect(estimate.crossCheck?.method).toBe("acceleration");

    const crank = buildDynoChartRows(estimate, "crank");
    const wheel = buildDynoChartRows(estimate, "wheel");
    expect(crank.length).toBeGreaterThan(4);
    // Rows are sorted and both curves land on the same grid.
    expect([...crank].sort((a, b) => a.rpm - b.rpm)).toEqual(crank);
    expect(crank.some((r) => r.refPower !== null && r.refPower !== undefined)).toBe(true);
    // Wheel figures are the crank ones minus the drivetrain loss.
    const i = crank.findIndex((r) => r.power !== null);
    expect(wheel[i].power!).toBeLessThan(crank[i].power!);
  });

  it("yields an empty row set when nothing could be estimated", () => {
    const empty = estimateDyno(makeLog([]), PROFILE);
    expect(buildDynoChartRows(empty, "crank")).toEqual([]);
  });
});

describe("dyno profile — geometry & defensive loading", () => {
  it("computes the rolling circumference from a tyre size", () => {
    // 225/40R18 → Ø 637.2 mm → U ≈ 2.002 m
    expect(tireCircumferenceM({ widthMm: 225, aspectPct: 40, rimIn: 18 })).toBeCloseTo(2.002, 3);
    // A taller sidewall rolls further per revolution.
    expect(tireCircumferenceM({ widthMm: 225, aspectPct: 45, rimIn: 18 })).toBeGreaterThan(
      tireCircumferenceM({ widthMm: 225, aspectPct: 40, rimIn: 18 }),
    );
  });

  it("resolves the total reduction for a gear, or null when unknown", () => {
    expect(totalRatioFor(DEFAULT_DYNO_PROFILE, 3)).toBeCloseTo(2.143 * DEFAULT_DYNO_PROFILE.finalDrive, 6);
    expect(totalRatioFor(DEFAULT_DYNO_PROFILE, 99)).toBeNull();
    expect(totalRatioFor(DEFAULT_DYNO_PROFILE, null)).toBeNull();
  });

  it("falls back to the default profile for corrupt stored values", () => {
    expect(coerceDynoProfile(null)).toEqual(DEFAULT_DYNO_PROFILE);
    expect(coerceDynoProfile("nope")).toEqual(DEFAULT_DYNO_PROFILE);
    const coerced = coerceDynoProfile({
      massKg: 1720,
      drivetrainLossPct: "lots",
      displacementL: 0,
      gramsPerHp: 0.75,
      tire: { widthMm: 265, aspectPct: 35, rimIn: 19 },
      gear: 4,
    });
    expect(coerced.massKg).toBe(1720);
    expect(coerced.gramsPerHp).toBe(0.75);
    expect(coerced.gear).toBe(4);
    expect(coerced.tire).toEqual({ widthMm: 265, aspectPct: 35, rimIn: 19 });
    // Out-of-range / wrong-typed values fall back rather than poisoning the maths.
    expect(coerced.drivetrainLossPct).toBe(DEFAULT_DYNO_PROFILE.drivetrainLossPct);
    expect(coerced.displacementL).toBe(DEFAULT_DYNO_PROFILE.displacementL);
  });
});
