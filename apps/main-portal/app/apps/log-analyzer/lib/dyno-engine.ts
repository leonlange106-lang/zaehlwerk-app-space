import { resolveChannels, type ResolvedChannels } from "./channels";
import { detectPull, toBar } from "./evaluate-log-pull";
import {
  tireCircumferenceM,
  totalRatioFor,
  type DynoProfile,
} from "./dyno-spec";
import type { LogSeries, ParsedLog } from "./types";

// The virtual dyno: estimate crank/wheel power and torque over a WOT pull from
// nothing but a datalog and the car's physical profile. Two independent methods,
// so one can sanity-check the other:
//
//   1. AIR MASS (primary) — an engine's power is set by how much air it burns.
//      Either straight from a logged MAF trace, or estimated from manifold
//      pressure + intake air temperature + displacement via the ideal gas law
//      and a volumetric-efficiency factor. Robust because it needs no knowledge
//      of mass, gearing or road load, and it is unaffected by wind or gradient.
//   2. ACCELERATION / VEHICLE DYNAMICS (cross-check) — Newton on the road:
//      F = m·a + F_drag + F_roll, P = F·v. Needs the vehicle profile to be
//      right, but it measures what actually reached the tarmac.
//
// Both are estimates. A pull on an uphill road, a headwind, a slipping torque
// converter or a wrong VE will move the numbers by several percent — this is a
// repeatable comparison tool (before/after a map change), not a certified dyno.
//
// Everything here is pure and framework-free: no DOM, no storage, no I/O.

// ── Physical constants & unit conversions ──────────────────────────────────

/** Specific gas constant of dry air, J/(kg·K). */
const R_AIR = 287.058;
/** Standard gravity, m/s². */
const G = 9.80665;
/** 1 PS in kW (metric horsepower). */
const KW_PER_PS = 0.73549875;
/** 1 hp (SAE/mechanical) in kW. */
const KW_PER_HP = 0.745699872;
/** P[kW] = M[Nm] · n[rpm] / 9549.297 */
const KW_RPM_PER_NM = 9549.297;

export function kwToPs(kw: number): number {
  return kw / KW_PER_PS;
}

export function psToKw(ps: number): number {
  return ps * KW_PER_PS;
}

/** Torque (Nm) that produces `kw` at `rpm`. */
export function torqueNm(kw: number, rpm: number): number {
  if (rpm <= 0) return 0;
  return (kw * KW_RPM_PER_NM) / rpm;
}

/**
 * Normalise a mass-air-flow reading to g/s. MGflasher logs g/s, MHD tends to
 * kg/h and US tools lb/min — all three appear in the wild. A unit-less channel
 * is assumed to already be g/s (the MGflasher default).
 */
export function toGramsPerSecond(value: number, unit: string | null): number {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("kg/h") || u.includes("kgh")) return value / 3.6;
  if (u.includes("kg/min")) return (value * 1000) / 60;
  if (u.includes("lb/min") || u.includes("lbmin") || u.includes("lb/m")) return value * 7.55987;
  if (u.includes("lb/h")) return value * 0.1259978;
  if (u.includes("g/min")) return value / 60;
  return value; // g/s (or unknown → assume the common case)
}

/** Normalise a road-speed reading to m/s. Unit-less is assumed km/h. */
export function toMetersPerSecond(value: number, unit: string | null): number {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("mph")) return value * 0.44704;
  if (u === "m/s" || u.includes("m/s")) return value;
  return value / 3.6; // km/h / kph / unknown
}

/**
 * Normalise a pressure reading to hPa (= mbar). When the channel carries no
 * unit we fall back to magnitude: barometric pressure reads ~1.0 in bar, ~101
 * in kPa and ~1013 in hPa, three bands that cannot be confused.
 */
export function toHectoPascal(value: number, unit: string | null): number {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("mpa")) return value * 10000;
  if (u.includes("kpa")) return value * 10;
  if (u.includes("hpa") || u.includes("mbar")) return value;
  if (u.includes("bar")) return value * 1000;
  if (u.includes("psi")) return value * 68.9476;
  if (u.includes("inhg")) return value * 33.8639;
  if (value < 2) return value * 1000;
  if (value < 200) return value * 10;
  return value;
}

// ── Atmospheric correction (SAE J1349 / DIN 70020) ─────────────────────────

/** Which standard the estimated power is corrected to (or none at all). */
export type CorrectionStandard = "none" | "sae" | "din";

export const CORRECTION_LABELS: Record<CorrectionStandard, string> = {
  none: "Unkorrigiert",
  sae: "SAE J1349",
  din: "DIN 70020",
};

/** SAE J1349 reference: 990 hPa dry air at 25 °C. */
const SAE_REF_HPA = 990;
const SAE_REF_K = 298;
/** DIN 70020 reference: 1013 hPa at 20 °C. */
const DIN_REF_HPA = 1013;
const DIN_REF_K = 293.15;

/**
 * Correction factors are only meaningful near real ambient conditions; a broken
 * or mis-scaled pressure channel would otherwise scale the whole curve by an
 * absurd amount. Clamp to ±20 %, which comfortably covers sea level → ~2000 m
 * and −20 → +45 °C.
 */
const CF_MIN = 0.8;
const CF_MAX = 1.2;

function clampFactor(cf: number): number {
  if (!Number.isFinite(cf)) return 1;
  return Math.min(CF_MAX, Math.max(CF_MIN, cf));
}

/**
 * The atmospheric correction factor the measured power is multiplied by to
 * express it at the standard's reference conditions. Both formulas assume DRY
 * air (no humidity channel exists in these logs), which is the conservative
 * choice: ignoring water vapour slightly understates the correction.
 *
 *   SAE J1349: cf = 1.180 · [(990 / p) · √((T + 273) / 298)] − 0.18
 *   DIN 70020: cf = (1013 / p) · √((T + 273.15) / 293.15)
 *
 * Thinner (higher altitude) or hotter air means the engine made its power under
 * a handicap, so the factor rises above 1.
 */
export function correctionFactor(
  standard: CorrectionStandard,
  pressureHpa: number,
  tempC: number,
): number {
  if (standard === "none") return 1;
  if (!Number.isFinite(pressureHpa) || pressureHpa <= 0 || !Number.isFinite(tempC)) return 1;
  if (standard === "sae") {
    return clampFactor(1.18 * ((SAE_REF_HPA / pressureHpa) * Math.sqrt((tempC + 273) / SAE_REF_K)) - 0.18);
  }
  return clampFactor((DIN_REF_HPA / pressureHpa) * Math.sqrt((tempC + 273.15) / DIN_REF_K));
}

/** The ambient conditions a correction factor was computed from. */
export interface AmbientConditions {
  pressureHpa: number;
  tempC: number;
  /** True when the value came from a logged channel rather than the standard default. */
  pressureFromLog: boolean;
  tempFromLog: boolean;
}

/** Standard conditions used when the log carries no ambient channels. */
const DEFAULT_AMBIENT_HPA = 1013;
const DEFAULT_AMBIENT_C = 20;

/** Mean of a channel's non-null values within [lo, hi], or null. */
function meanOf(series: LogSeries | null, lo: number, hi: number): number | null {
  if (!series) return null;
  let sum = 0;
  let n = 0;
  for (let i = lo; i <= hi; i += 1) {
    const v = series.values[i];
    if (v === null || v === undefined) continue;
    sum += v;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/** Resolve the ambient conditions for the correction, falling back to standard. */
export function ambientFor(ch: ResolvedChannels, lo: number, hi: number): AmbientConditions {
  const rawPressure = meanOf(ch.ambientPressure, lo, hi);
  const rawTemp = meanOf(ch.ambientTemp, lo, hi);
  const pressureHpa =
    rawPressure === null ? null : toHectoPascal(rawPressure, ch.ambientPressure?.unit ?? null);
  // Guard against a mis-resolved channel: real barometric pressure at any
  // drivable altitude sits between ~700 and ~1100 hPa.
  const usablePressure = pressureHpa !== null && pressureHpa > 700 && pressureHpa < 1100;
  const usableTemp = rawTemp !== null && rawTemp > -40 && rawTemp < 60;
  return {
    pressureHpa: usablePressure ? (pressureHpa as number) : DEFAULT_AMBIENT_HPA,
    tempC: usableTemp ? (rawTemp as number) : DEFAULT_AMBIENT_C,
    pressureFromLog: usablePressure,
    tempFromLog: usableTemp,
  };
}

// ── Air-mass method ────────────────────────────────────────────────────────

/**
 * Crank power (kW) from an air-mass flow. `gramsPerHp` is the configurable
 * efficiency offset: 0.8 g/s of air per hp is the accepted baseline for modern
 * turbo petrol engines (BMW B48/B58 and friends).
 */
export function powerFromAirflowKw(gramsPerSecond: number, gramsPerHp: number): number {
  if (gramsPerHp <= 0) return 0;
  return (gramsPerSecond / gramsPerHp) * KW_PER_HP;
}

/**
 * Air mass flow (g/s) estimated from the speed-density model: the engine is a
 * pump that swallows `displacement / 2` per revolution (four-stroke), filled to
 * `VE` with charge of the density the ideal gas law gives for the manifold
 * pressure and intake temperature.
 */
export function airflowFromSpeedDensity(
  manifoldKpa: number,
  intakeTempC: number,
  rpm: number,
  displacementL: number,
  volumetricEfficiency: number,
): number {
  if (rpm <= 0 || manifoldKpa <= 0) return 0;
  const density = (manifoldKpa * 1000) / (R_AIR * (intakeTempC + 273.15)); // kg/m³
  const volumeFlowM3s = ((displacementL / 1000) * (rpm / 2)) / 60;
  return density * volumeFlowM3s * volumetricEfficiency * 1000;
}

/**
 * Whether a pressure channel reads ABSOLUTE manifold pressure rather than the
 * usual gauge/relative boost. A relative trace dips to ~0 (or into vacuum) at
 * some point in every log; an absolute one never goes near zero. 0.5 bar sits
 * safely between "deep vacuum on overrun" and "idle manifold pressure".
 */
function isAbsolutePressure(series: LogSeries): boolean {
  let min: number | null = null;
  for (const v of series.values) {
    if (v === null || v === undefined) continue;
    const bar = toBar(v, series.unit);
    if (min === null || bar < min) min = bar;
  }
  return min !== null && min > 0.5;
}

// ── Curve assembly ─────────────────────────────────────────────────────────

/** How a curve was derived. */
export type DynoMethod = "airmass" | "acceleration";

export const METHOD_LABELS: Record<DynoMethod, string> = {
  airmass: "Luftmasse",
  acceleration: "Beschleunigung",
};

/** Which method to prefer; "auto" takes air mass when the channels allow it. */
export type MethodPreference = "auto" | DynoMethod;

/** One point of a finished power/torque curve. */
export interface DynoPoint {
  rpm: number;
  /** Power at the crankshaft, after drivetrain-loss compensation & correction. */
  crankKw: number;
  crankPs: number;
  crankNm: number;
  /** Power at the wheels. */
  wheelKw: number;
  wheelPs: number;
  wheelNm: number;
}

export interface DynoCurve {
  method: DynoMethod;
  /** Where the underlying airflow / road speed came from (for the UI subline). */
  source: string;
  points: DynoPoint[];
  /** The point of maximum power (crank and wheel peak at the same rpm). */
  peakPower: DynoPoint | null;
  /** The point of maximum torque. */
  peakTorque: DynoPoint | null;
  /** The atmospheric factor applied to every point (1 when uncorrected). */
  correctionFactor: number;
  ambient: AmbientConditions;
}

export interface DynoEstimate {
  /** The curve the UI leads with, or null when nothing could be estimated. */
  primary: DynoCurve | null;
  /** The other method's curve when it is also computable — a sanity check. */
  crossCheck: DynoCurve | null;
  /** German notes: which method was used, what was missing, what was assumed. */
  notes: string[];
  /** The detected WOT pull window the curves were built over. */
  window: [number, number];
  /** True when the pull window came from a real pedal-driven WOT run. */
  pedalDriven: boolean;
}

/** RPM bucket width the raw samples are averaged into. */
const RPM_BIN = 100;
/** A curve needs at least this many bins and rpm span to be worth showing. */
const MIN_BINS = 4;
const MIN_RPM_SPAN = 500;
/** Below this many samples a pull window cannot produce a meaningful curve. */
const MIN_PULL_SAMPLES = 5;

interface RawSample {
  rpm: number;
  /** Power at the crank, in kW, before atmospheric correction. */
  crankKw: number;
}

/**
 * Average the raw samples into fixed RPM buckets and smooth the result. Logs
 * sample on time, so the low-rpm end of a pull is far denser than the top —
 * binning on rpm gives the curve an even X spacing, and the 1-2-1 kernel takes
 * the sensor noise out without flattening the peak.
 */
function binAndSmooth(samples: RawSample[]): { rpm: number; kw: number }[] {
  if (samples.length === 0) return [];
  const bins = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.round(s.rpm / RPM_BIN) * RPM_BIN;
    const bin = bins.get(key) ?? { sum: 0, n: 0 };
    bin.sum += s.crankKw;
    bin.n += 1;
    bins.set(key, bin);
  }
  const raw = [...bins.entries()]
    .map(([rpm, b]) => ({ rpm, kw: b.sum / b.n }))
    .sort((a, b) => a.rpm - b.rpm);

  return raw.map((p, i) => {
    const prev = raw[i - 1] ?? p;
    const next = raw[i + 1] ?? p;
    return { rpm: p.rpm, kw: 0.25 * prev.kw + 0.5 * p.kw + 0.25 * next.kw };
  });
}

/** Turn smoothed crank-kW bins into the finished, corrected curve. */
function buildCurve(
  samples: RawSample[],
  method: DynoMethod,
  source: string,
  profile: DynoProfile,
  standard: CorrectionStandard,
  ambient: AmbientConditions,
): DynoCurve | null {
  const smoothed = binAndSmooth(samples);
  if (smoothed.length < MIN_BINS) return null;
  const span = smoothed[smoothed.length - 1].rpm - smoothed[0].rpm;
  if (span < MIN_RPM_SPAN) return null;

  const cf = correctionFactor(standard, ambient.pressureHpa, ambient.tempC);
  const lossFactor = 1 - Math.min(0.45, Math.max(0, profile.drivetrainLossPct / 100));

  const points: DynoPoint[] = [];
  for (const p of smoothed) {
    const crankKw = p.kw * cf;
    if (!Number.isFinite(crankKw) || crankKw <= 0) continue;
    const wheelKw = crankKw * lossFactor;
    points.push({
      rpm: p.rpm,
      crankKw,
      crankPs: kwToPs(crankKw),
      crankNm: torqueNm(crankKw, p.rpm),
      wheelKw,
      wheelPs: kwToPs(wheelKw),
      wheelNm: torqueNm(wheelKw, p.rpm),
    });
  }
  if (points.length < MIN_BINS) return null;

  let peakPower = points[0];
  let peakTorque = points[0];
  for (const p of points) {
    if (p.crankKw > peakPower.crankKw) peakPower = p;
    if (p.crankNm > peakTorque.crankNm) peakTorque = p;
  }

  return { method, source, points, peakPower, peakTorque, correctionFactor: cf, ambient };
}

// ── Method 1: air mass ─────────────────────────────────────────────────────

function airMassSamples(
  ch: ResolvedChannels,
  profile: DynoProfile,
  lo: number,
  hi: number,
  ambient: AmbientConditions,
): { samples: RawSample[]; source: string } | null {
  const rpm = ch.rpm;
  if (!rpm) return null;

  // Preferred: a real MAF trace — no modelling assumptions at all.
  if (ch.maf) {
    const maf = ch.maf;
    const samples: RawSample[] = [];
    for (let i = lo; i <= hi; i += 1) {
      const r = rpm.values[i];
      const m = maf.values[i];
      if (r === null || r === undefined || m === null || m === undefined || r <= 0 || m <= 0) continue;
      samples.push({ rpm: r, crankKw: powerFromAirflowKw(toGramsPerSecond(m, maf.unit), profile.gramsPerHp) });
    }
    if (samples.length > 0) return { samples, source: `MAF · ${maf.label}` };
  }

  // Fallback: speed-density from manifold pressure + intake air temperature.
  const boost = ch.boostActual;
  if (!boost) return null;
  const absolute = isAbsolutePressure(boost);
  const samples: RawSample[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const r = rpm.values[i];
    const b = boost.values[i];
    if (r === null || r === undefined || b === null || b === undefined || r <= 0) continue;
    const bar = toBar(b, boost.unit);
    const manifoldKpa = absolute ? bar * 100 : ambient.pressureHpa / 10 + bar * 100;
    // Charge temperature: the logged IAT is what actually entered the cylinder;
    // without it, ambient is the best available stand-in.
    const iat = ch.iat?.values[i];
    const tempC = iat === null || iat === undefined ? ambient.tempC : iat;
    const gs = airflowFromSpeedDensity(
      manifoldKpa,
      tempC,
      r,
      profile.displacementL,
      profile.volumetricEfficiency,
    );
    if (gs <= 0) continue;
    samples.push({ rpm: r, crankKw: powerFromAirflowKw(gs, profile.gramsPerHp) });
  }
  if (samples.length === 0) return null;
  return {
    samples,
    source: `Speed-Density · ${boost.label}${ch.iat ? ` + ${ch.iat.label}` : ""} (VE ${profile.volumetricEfficiency.toFixed(2)})`,
  };
}

// ── Method 2: acceleration / vehicle dynamics ──────────────────────────────

/** Half-width (in samples) of the central difference used for dv/dt. */
const DERIVATIVE_HALF_WINDOW = 2;

/** Most frequent non-null gear within [lo, hi], or null. */
function dominantGear(gear: LogSeries | null, lo: number, hi: number): number | null {
  if (!gear) return null;
  const counts = new Map<number, number>();
  for (let i = lo; i <= hi; i += 1) {
    const g = gear.values[i];
    if (g === null || g === undefined) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [g, n] of counts) {
    if (n > bestCount) {
      best = g;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Road speed in m/s for every sample, either from a logged speed channel or —
 * failing that — derived from engine speed through the gearing and tyre size.
 * The derived path is exactly how an inertia dyno works: in a known gear, engine
 * rpm IS road speed.
 */
function roadSpeed(
  ch: ResolvedChannels,
  profile: DynoProfile,
  lo: number,
  hi: number,
): { values: (number | null)[]; source: string } | null {
  if (ch.vehicleSpeed) {
    const s = ch.vehicleSpeed;
    return {
      values: s.values.map((v) => (v === null || v === undefined ? null : toMetersPerSecond(v, s.unit))),
      source: `Fahrzeuggeschwindigkeit · ${s.label}`,
    };
  }
  if (!ch.rpm) return null;
  const gear = profile.gear ?? dominantGear(ch.gear, lo, hi);
  const ratio = totalRatioFor(profile, gear);
  if (ratio === null) return null;
  const circumference = tireCircumferenceM(profile.tire);
  return {
    values: ch.rpm.values.map((v) =>
      v === null || v === undefined || v <= 0 ? null : (v / 60 / ratio) * circumference,
    ),
    source: `Aus Drehzahl · Gang ${gear} (i=${ratio.toFixed(2)})`,
  };
}

function accelerationSamples(
  log: ParsedLog,
  ch: ResolvedChannels,
  profile: DynoProfile,
  lo: number,
  hi: number,
  ambient: AmbientConditions,
): { samples: RawSample[]; source: string } | null {
  // Differentiating an index axis would yield "m per sample", not m/s².
  if (log.timeUnit !== "s" || !ch.rpm) return null;
  const speed = roadSpeed(ch, profile, lo, hi);
  if (!speed) return null;

  const lossFactor = 1 - Math.min(0.45, Math.max(0, profile.drivetrainLossPct / 100));
  if (lossFactor <= 0) return null;
  // Air density at the ambient conditions, for the drag term.
  const airDensity = (ambient.pressureHpa * 100) / (R_AIR * (ambient.tempC + 273.15));
  const dragK = 0.5 * airDensity * profile.dragCoefficient * profile.frontalAreaM2;
  const rollN = profile.rollingResistance * profile.massKg * G;
  const effectiveMass = profile.massKg * profile.rotatingMassFactor;

  const samples: RawSample[] = [];
  for (let i = lo + DERIVATIVE_HALF_WINDOW; i <= hi - DERIVATIVE_HALF_WINDOW; i += 1) {
    const r = ch.rpm.values[i];
    const v = speed.values[i];
    const vBack = speed.values[i - DERIVATIVE_HALF_WINDOW];
    const vFwd = speed.values[i + DERIVATIVE_HALF_WINDOW];
    const tBack = log.time[i - DERIVATIVE_HALF_WINDOW];
    const tFwd = log.time[i + DERIVATIVE_HALF_WINDOW];
    if (r === null || r === undefined || r <= 0) continue;
    if (v === null || vBack === null || vFwd === null) continue;
    if (tBack === undefined || tFwd === undefined) continue;
    const dt = tFwd - tBack;
    if (dt <= 0 || v <= 1) continue; // standstill / crawl carries no usable power
    const a = (vFwd - vBack) / dt;
    if (a <= 0) continue; // coasting or braking — not a power measurement
    const force = effectiveMass * a + dragK * v * v + rollN;
    const wheelKw = (force * v) / 1000;
    if (!Number.isFinite(wheelKw) || wheelKw <= 0) continue;
    samples.push({ rpm: r, crankKw: wheelKw / lossFactor });
  }
  if (samples.length === 0) return null;
  return { samples, source: speed.source };
}

// ── Entry point ────────────────────────────────────────────────────────────

export interface DynoOptions {
  /** Atmospheric correction standard. Default: none (raw estimate). */
  correction?: CorrectionStandard;
  /** Which method leads. Default: "auto" (air mass when possible). */
  method?: MethodPreference;
}

/**
 * Estimate the power and torque curves of a log's detected WOT pull. Total: a
 * log with no usable channels yields an estimate with null curves and notes
 * explaining what is missing, never an exception.
 */
export function estimateDyno(
  log: ParsedLog,
  profile: DynoProfile,
  options: DynoOptions = {},
): DynoEstimate {
  const { correction = "none", method = "auto" } = options;
  const ch = resolveChannels(log);
  const pull = detectPull(log, ch);
  const [lo, hi] = pull.window;
  const notes: string[] = [];
  const base: Omit<DynoEstimate, "primary" | "crossCheck"> = {
    notes,
    window: pull.window,
    pedalDriven: pull.pedalDriven,
  };

  if (!ch.rpm) {
    notes.push("Kein Drehzahl-Kanal im Log – ohne RPM ist keine Leistungskurve möglich.");
    return { primary: null, crossCheck: null, ...base };
  }
  if (hi - lo + 1 < MIN_PULL_SAMPLES) {
    notes.push("Das erkannte Pull-Fenster ist zu kurz für eine Leistungsschätzung.");
    return { primary: null, crossCheck: null, ...base };
  }
  if (!pull.pedalDriven) {
    notes.push(
      "Kein Pedal-Kanal – das Auswertefenster stammt aus dem Drehzahlverlauf und ist nur eine Näherung.",
    );
  }

  const ambient = ambientFor(ch, lo, hi);
  if (correction !== "none" && !ambient.pressureFromLog) {
    notes.push(
      `Kein Umgebungsdruck im Log – Korrektur rechnet mit Normbedingungen (${DEFAULT_AMBIENT_HPA} hPa, ${DEFAULT_AMBIENT_C} °C).`,
    );
  }

  const air = airMassSamples(ch, profile, lo, hi, ambient);
  const accel = accelerationSamples(log, ch, profile, lo, hi, ambient);

  const airCurve = air ? buildCurve(air.samples, "airmass", air.source, profile, correction, ambient) : null;
  const accelCurve = accel
    ? buildCurve(accel.samples, "acceleration", accel.source, profile, correction, ambient)
    : null;

  if (!airCurve) {
    notes.push(
      ch.maf || ch.boostActual
        ? "Luftmassen-Methode nicht auswertbar – zu wenige verwertbare Samples im Pull-Fenster."
        : "Weder MAF- noch Ladedruck-Kanal gefunden – die Luftmassen-Methode entfällt.",
    );
  } else if (!ch.maf) {
    notes.push(
      "Kein MAF-Kanal – die Luftmasse wird über Ladedruck, Ansauglufttemperatur und Hubraum (VE-Modell) geschätzt.",
    );
  }
  if (!accelCurve) {
    notes.push(
      log.timeUnit !== "s"
        ? "Keine echte Zeitachse – die Beschleunigungs-Methode entfällt."
        : "Beschleunigungs-Methode nicht auswertbar – ohne Geschwindigkeits-Kanal wird ein Gang-Übersetzungsverhältnis benötigt.",
    );
  }

  // "auto" leads with air mass: it needs no vehicle profile to be correct and is
  // immune to gradient and wind. An explicit choice always wins when computable.
  let primary: DynoCurve | null;
  let crossCheck: DynoCurve | null;
  if (method === "acceleration") {
    primary = accelCurve ?? airCurve;
    crossCheck = primary === accelCurve ? airCurve : accelCurve;
  } else {
    primary = airCurve ?? accelCurve;
    crossCheck = primary === airCurve ? accelCurve : airCurve;
  }
  if (method !== "auto" && primary && primary.method !== method) {
    notes.push(
      `Die gewählte Methode (${METHOD_LABELS[method]}) ist für dieses Log nicht auswertbar – es wird ${METHOD_LABELS[primary.method]} gezeigt.`,
    );
  }
  if (primary === crossCheck) crossCheck = null;

  return { primary, crossCheck, ...base };
}

// ── Chart data ─────────────────────────────────────────────────────────────

/** Which side of the drivetrain the figures are reported at. */
export type DynoOutput = "crank" | "wheel";

export const OUTPUT_LABELS: Record<DynoOutput, string> = {
  crank: "Kurbelwelle",
  wheel: "Rad",
};

/** Read power/torque off a point for the selected output side. */
export function powerOf(point: DynoPoint, output: DynoOutput): { ps: number; kw: number; nm: number } {
  return output === "wheel"
    ? { ps: point.wheelPs, kw: point.wheelKw, nm: point.wheelNm }
    : { ps: point.crankPs, kw: point.crankKw, nm: point.crankNm };
}

export interface DynoChartRow {
  rpm: number;
  /** Power (PS) of the primary curve. */
  power: number | null;
  /** Torque (Nm) of the primary curve. */
  torque: number | null;
  /** Power (PS) of the cross-check curve, when there is one. */
  refPower?: number | null;
}

/**
 * Merge the primary and cross-check curves onto one row set for the chart. Both
 * are binned on the same RPM grid, so they join cleanly by rpm; a bin only one
 * of them reached simply carries a null on the other side.
 */
export function buildDynoChartRows(estimate: DynoEstimate, output: DynoOutput): DynoChartRow[] {
  const rows = new Map<number, DynoChartRow>();
  const rowAt = (rpm: number): DynoChartRow => {
    const existing = rows.get(rpm);
    if (existing) return existing;
    const created: DynoChartRow = { rpm, power: null, torque: null };
    rows.set(rpm, created);
    return created;
  };

  for (const p of estimate.primary?.points ?? []) {
    const v = powerOf(p, output);
    const row = rowAt(p.rpm);
    row.power = Math.round(v.ps * 10) / 10;
    row.torque = Math.round(v.nm * 10) / 10;
  }
  if (estimate.crossCheck) {
    for (const p of estimate.crossCheck.points) {
      const row = rowAt(p.rpm);
      row.refPower = Math.round(powerOf(p, output).ps * 10) / 10;
    }
  }
  return [...rows.values()].sort((a, b) => a.rpm - b.rpm);
}
