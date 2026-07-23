import { resolveChannels, type ResolvedChannels } from "./channels";
import type { LogSeries, ParsedLog } from "./types";
import { limitsForSpec, WOT_THRESHOLD_PCT, type SpecLimits, type VehicleSpec } from "./vehicle-spec";

// The automated log-pull evaluation engine — the analytical heart of the
// analyzer. Given a parsed log and the vehicle's engine/hardware spec it answers:
//
//   1. Is this a valid WOT pull? (dyno gear 3/4, full throttle, redline sweep)
//   2. Are the parameters needed for a real analysis actually logged?
//   3. Are there safety/health red flags? (knock, boost deviation, fuel trims,
//      fuel starvation, EGT over the hardware-contextual limit) — each pinned to
//      the exact timestamp it occurred so the charts can mark it.
//
// Everything here is pure: no DOM, no storage, no framework. `evaluateLogPull`
// is the single public entry point. All engine/hardware-dependent thresholds
// come from `SpecLimits` (see vehicle-spec.ts); only genuinely universal
// coverage fractions remain as module constants.

// ── Universal (engine-independent) thresholds ──────────────────────────────
/** Fraction of the pull window that must be WOT for a clean "wot" verdict. */
const WOT_COVERAGE_OK = 0.9;
/** Below this WOT fraction the pull is considered invalid (not a real pull). */
const WOT_COVERAGE_MIN = 0.5;
/** A valid WOT pull must start in at least this gear (1st/2nd-gear pulls are ignored). */
const MIN_PULL_GEAR = 3;

// Gear-shift exclusion zone: from just before a shift until the driveline has
// re-settled. Sized from the reference logs — after a 5→6 shift the boost
// overshoots (~+0.14 bar) and EGT spikes for ~0.5–1.0 s before settling — so we
// suppress evaluation across [shift − PRE, shift + POST]. Time-based when a real
// seconds axis exists, else a sample-count fallback.
const SHIFT_ZONE_PRE_S = 0.2;
const SHIFT_ZONE_POST_S = 1.0;
const SHIFT_ZONE_PRE_SAMPLES = 1;
const SHIFT_ZONE_POST_SAMPLES = 8;

export type PullStatus = "verified" | "partial" | "invalid";

/**
 * Hardware-health classification derived from the safety alerts: a critical
 * alert (knock, EGT over limit, fuel starvation) means the run stressed the
 * hardware; warnings warrant a look; nothing means it ran clean.
 */
export type PullHealth = "safe" | "caution" | "danger";

export function healthFromAlerts(alerts: SafetyAlert[]): PullHealth {
  if (alerts.some((a) => a.severity === "critical")) return "danger";
  if (alerts.length > 0) return "caution";
  return "safe";
}

export interface PullValidity {
  status: PullStatus;
  /** True when the pull spans exactly one gear (informational). Null if no gear channel. */
  singleGear: boolean | null;
  /** The gear the pull STARTS in. Null if no gear channel. */
  gearValue: number | null;
  /** True when the start gear is ≥ MIN_PULL_GEAR (i.e. not a 1st/2nd-gear pull). Null if unknown. */
  gearInRange: boolean | null;
  /** Distinct gears the pull runs through, in order (e.g. [5, 6]). */
  gears: number[];
  /** True when the pull seamlessly spans two consecutive gears (3→4, 4→5, 5→6). */
  multiGear: boolean;
  /** True when throttle stays ≥ WOT threshold across the window. Null if unknown. */
  wot: boolean | null;
  /** Fraction [0..1] of the window at WOT, or null when no throttle channel. */
  wotCoverage: number | null;
  rpmStart: number | null;
  rpmEnd: number | null;
  /** True when the RPM sweep spans ≤ rpmStartMax … ≥ rpmEndMin. */
  rpmSpanOk: boolean;
  /** Human-readable German notes explaining anything less than ideal. */
  reasons: string[];
}

export interface MissingParamHint {
  /** Canonical parameter key, e.g. "stft". */
  key: string;
  label: string;
  /** Actionable German hint pointing the user at their logging profile. */
  message: string;
}

export type AlertSeverity = "warning" | "critical";

export interface SafetyAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

/**
 * A single threshold breach pinned to the exact sample/timestamp it happened, so
 * the synchronized charts can draw a red marker there with a precise tooltip.
 */
export interface Violation {
  id: string;
  severity: AlertSeverity;
  /** Sample index within the log. */
  sampleIndex: number;
  /** X-axis value (seconds or sample index) — ready for a Recharts ReferenceLine. */
  time: number;
  /** Short label, e.g. "Klopfen Zyl 1". */
  label: string;
  /** Precise detail, e.g. "Zündwinkel-Korrektur: -3.5°". */
  detail: string;
}

/** A time-axis range (verified-pull window, or a shift-exclusion zone). */
export interface PullRange {
  start: number;
  end: number;
}

export interface LogPullEvaluation {
  validity: PullValidity;
  missing: MissingParamHint[];
  alerts: SafetyAlert[];
  /** Time-stamped threshold breaches for the chart overlays. */
  violations: Violation[];
  /** The detected pull window on the X axis, or null when not resolvable. */
  pullRange: PullRange | null;
  /** Gear-shift zones (X-axis ranges) excluded from safety evaluation. */
  exclusionRanges: PullRange[];
  /** The hardware-contextual limits the alerts were judged against. */
  limits: SpecLimits;
  /** The [start, end] sample indices of the detected pull window. */
  window: [number, number];
}

/** Non-null numeric extremum helpers that ignore gaps. */
function maxOf(values: (number | null)[], lo = 0, hi = values.length - 1): number | null {
  let m: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (m === null || v > m) m = v;
  }
  return m;
}

function minOf(values: (number | null)[], lo = 0, hi = values.length - 1): number | null {
  let m: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (m === null || v < m) m = v;
  }
  return m;
}

/** Index of the max non-null value in [lo, hi], or -1 if the range is all gaps. */
function argMax(values: (number | null)[], lo: number, hi: number): number {
  let idx = -1;
  let best: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (best === null || v > best) {
      best = v;
      idx = i;
    }
  }
  return idx;
}

function argMin(values: (number | null)[], lo: number, hi: number): number {
  let idx = -1;
  let best: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (best === null || v < best) {
      best = v;
      idx = i;
    }
  }
  return idx;
}

/**
 * Fallback window when there is no usable pedal channel: from the RPM low point
 * that precedes peak RPM up to the peak, isolating the acceleration sweep.
 */
function detectRpmWindow(log: ParsedLog, rpm: LogSeries | null): [number, number] {
  const last = log.time.length - 1;
  if (last < 0) return [0, 0];
  if (!rpm) return [0, last];
  const peak = argMax(rpm.values, 0, last);
  if (peak <= 0) return [0, last];
  const start = argMin(rpm.values, 0, peak);
  return [start < 0 ? 0 : start, peak];
}

/** First non-null gear at/after `from`, scanning up to a small look-ahead. */
function firstGearFrom(gear: LogSeries, from: number, hi: number): number | null {
  for (let i = from; i <= hi; i += 1) {
    const g = gear.values[i];
    if (g !== null) return g;
  }
  return null;
}

/** Distinct non-null gears within [lo, hi], in first-seen order. */
function distinctGears(gear: LogSeries | null, lo: number, hi: number): number[] {
  if (!gear) return [];
  const out: number[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const g = gear.values[i];
    if (g !== null && !out.includes(g)) out.push(g);
  }
  return out;
}

export interface DetectedPull {
  window: [number, number];
  /** Gear the pull starts in, or null when no gear channel. */
  startGear: number | null;
  /** Distinct gears within the window, in order. */
  gears: number[];
  /** startGear ≥ MIN_PULL_GEAR, or null when unknown. */
  gearStartOk: boolean | null;
  /** Whether the window came from a real pedal-WOT run (vs. the RPM fallback). */
  pedalDriven: boolean;
}

function scorePull(pull: DetectedPull, rpm: LogSeries | null): number {
  const [lo, hi] = pull.window;
  const len = hi - lo + 1;
  // Score by the RPM SPAN swept, not peak RPM: the real pull climbs from near
  // idle to redline, whereas a short high-gear fragment sits at high RPM with a
  // tiny span — span cleanly prefers the genuine pull.
  let span = 0;
  if (rpm) {
    const hiRpm = maxOf(rpm.values, lo, hi);
    const loRpm = minOf(rpm.values, lo, hi);
    if (hiRpm !== null && loRpm !== null) span = hiRpm - loRpm;
  }
  // Strongly prefer a pull that starts in a legal gear (≥ 3), then the widest
  // sweep, then the longer one.
  const legalBonus = pull.gearStartOk !== false ? 1_000_000_000 : 0;
  return legalBonus + span * 1000 + len;
}

/**
 * Detect the WOT pull, strictly per the tuning rules:
 *  - the interval starts at the FIRST sample where the accelerator pedal ≥ WOT
 *    threshold (pre-WOT ramp-up is excluded),
 *  - it may span ONE or TWO consecutive gears (e.g. 3→4, 5→6); the second gear
 *    is not required to start below the RPM threshold,
 *  - it ends the moment the pedal drops below WOT or a shift into a THIRD
 *    consecutive gear (or a downshift) occurs,
 *  - pulls starting in gear 1 or 2 are ignored.
 *
 * When several WOT runs exist the strongest legal one wins. Falls back to the
 * RPM-sweep window when there is no pedal channel or no WOT run at all.
 */
function detectPull(log: ParsedLog, ch: ResolvedChannels): DetectedPull {
  const last = log.time.length - 1;
  const pedal = ch.throttle; // resolves to the accelerator pedal (preferred)
  const gear = ch.gear;

  const rpmFallback = (): DetectedPull => {
    const window = detectRpmWindow(log, ch.rpm);
    const startGear = gear ? firstGearFrom(gear, window[0], window[1]) : null;
    return {
      window,
      startGear,
      gears: distinctGears(gear, window[0], window[1]),
      gearStartOk: startGear === null ? null : startGear >= MIN_PULL_GEAR,
      pedalDriven: false,
    };
  };

  if (last < 0) return { window: [0, 0], startGear: null, gears: [], gearStartOk: null, pedalDriven: false };
  if (!pedal) return rpmFallback();

  const wot = WOT_THRESHOLD_PCT;
  let best: DetectedPull | null = null;
  let i = 0;
  while (i <= last) {
    const pv = pedal.values[i];
    if (pv === null || pv < wot) {
      i += 1;
      continue;
    }
    // A WOT run begins at i. Gate the gear span to {g0, g0+1}.
    const g0 = gear ? firstGearFrom(gear, i, last) : null;
    let end = i;
    let breakIdx = i + 1;
    for (let k = i; k <= last; k += 1) {
      const p = pedal.values[k];
      if (p === null || p < wot) {
        breakIdx = k + 1;
        break;
      }
      if (gear && g0 !== null) {
        const g = gear.values[k];
        if (g !== null && g !== g0 && g !== g0 + 1) {
          // Shift into a 3rd consecutive gear / a downshift ends the pull.
          breakIdx = k;
          break;
        }
      }
      end = k;
      breakIdx = k + 1;
    }

    const window: [number, number] = [i, end];
    const candidate: DetectedPull = {
      window,
      startGear: g0,
      gears: distinctGears(gear, i, end),
      gearStartOk: g0 === null ? null : g0 >= MIN_PULL_GEAR,
      pedalDriven: true,
    };
    if (!best || scorePull(candidate, ch.rpm) > scorePull(best, ch.rpm)) best = candidate;
    i = Math.max(breakIdx, end + 1);
  }

  return best ?? rpmFallback();
}

/**
 * Compute the gear-shift exclusion zones within the pull window: for every gear
 * change, the samples spanning [shift − PRE, shift + POST]. Returns both the
 * excluded sample indices (for the safety pass) and the X-axis ranges (for the
 * chart's grey "Schaltzone" bands).
 */
function computeShiftZones(
  log: ParsedLog,
  gear: LogSeries | null,
  window: [number, number],
): { excluded: Set<number>; ranges: PullRange[] } {
  const [lo, hi] = window;
  const excluded = new Set<number>();
  const ranges: PullRange[] = [];
  if (!gear || hi <= lo) return { excluded, ranges };

  const seconds = log.timeUnit === "s";
  const pre = seconds ? SHIFT_ZONE_PRE_S : SHIFT_ZONE_PRE_SAMPLES;
  const post = seconds ? SHIFT_ZONE_POST_S : SHIFT_ZONE_POST_SAMPLES;

  for (let i = lo + 1; i <= hi; i += 1) {
    const g = gear.values[i];
    const gp = gear.values[i - 1];
    if (g === null || gp === null || g === gp) continue;
    const t0 = log.time[i];
    let rStart = t0;
    let rEnd = t0;
    for (let j = lo; j <= hi; j += 1) {
      const d = log.time[j] - t0;
      if (d >= -pre && d <= post) {
        excluded.add(j);
        if (log.time[j] < rStart) rStart = log.time[j];
        if (log.time[j] > rEnd) rEnd = log.time[j];
      }
    }
    ranges.push({ start: rStart, end: rEnd });
  }
  return { excluded, ranges };
}

function evaluateValidity(
  ch: ResolvedChannels,
  pull: DetectedPull,
  limits: SpecLimits,
): PullValidity {
  const [lo, hi] = pull.window;
  const reasons: string[] = [];

  // ── RPM span ──
  // rpmStart is the RPM at the FIRST WOT sample (the pull's start); rpmEnd is the
  // highest RPM reached anywhere in the (possibly two-gear) window — the shift
  // makes RPM peak mid-window, so we take the max, not the last sample.
  const rpmStart = ch.rpm ? ch.rpm.values[lo] ?? minOf(ch.rpm.values, lo, hi) : null;
  const rpmEnd = ch.rpm ? maxOf(ch.rpm.values, lo, hi) : null;
  const rpmSpanOk =
    rpmStart !== null &&
    rpmEnd !== null &&
    rpmStart <= limits.rpmStartMax &&
    rpmEnd >= limits.rpmEndMin;
  if (ch.rpm && rpmStart !== null && rpmStart > limits.rpmStartMax) {
    reasons.push(
      `Pull beginnt zu hoch (${Math.round(rpmStart)} RPM; erwartet ≤ ${limits.rpmStartMax} RPM im Startgang).`,
    );
  } else if (ch.rpm && rpmEnd !== null && rpmEnd < limits.rpmEndMin) {
    reasons.push(
      `Pull dreht nicht weit genug aus (max ${Math.round(rpmEnd)} RPM; erwartet ≥ ${limits.rpmEndMin} RPM).`,
    );
  } else if (!ch.rpm) {
    reasons.push("Kein RPM-Kanal gefunden – Pull-Umfang nicht verifizierbar.");
  }

  // ── Gear: min-gear-3 start + one/two consecutive gears ──
  const gears = pull.gears;
  const gearValue = pull.startGear;
  const singleGear = ch.gear ? gears.length <= 1 : null;
  const multiGear = gears.length === 2;
  const gearInRange = pull.gearStartOk; // startGear ≥ MIN_PULL_GEAR
  if (gearInRange === false) {
    reasons.push(
      `Pull startet in Gang ${gearValue ?? "?"} – Pulls in Gang 1/2 werden nicht gewertet (min. Gang ${MIN_PULL_GEAR}).`,
    );
  }

  // ── WOT / throttle (accelerator pedal) ──
  // The window is defined by pedal ≥ WOT, so coverage is ~100% for a real pull;
  // a low fraction here means the fallback (no WOT run) window was used.
  let wot: boolean | null = null;
  let wotCoverage: number | null = null;
  if (ch.throttle) {
    let total = 0;
    let open = 0;
    for (let i = lo; i <= hi; i += 1) {
      const v = ch.throttle.values[i];
      if (v === null) continue;
      total += 1;
      if (v >= limits.wotThreshold) open += 1;
    }
    if (total > 0) {
      wotCoverage = open / total;
      wot = wotCoverage >= WOT_COVERAGE_OK;
      if (!wot) {
        reasons.push(
          `Kein durchgängiger Volllastbereich (nur ${Math.round(wotCoverage * 100)}% ≥ ${limits.wotThreshold}% Pedal).`,
        );
      }
    }
  } else {
    reasons.push("Kein Pedal-/Accelerator-Kanal – Volllast nicht verifizierbar.");
  }

  // ── Status roll-up ──
  // No RPM channel, a sub-threshold throttle, or a 1st/2nd-gear start means we
  // can't call it a valid pull. A pedal-driven WOT run that starts ≤ rpmStartMax
  // in gear ≥ 3, spans one or two consecutive gears, and revs to ≥ rpmEndMin is
  // verified; anything short of that (but still a real WOT run) is partial.
  const wotClearlyLow = wotCoverage !== null && wotCoverage < WOT_COVERAGE_MIN;
  const noRpm = ch.rpm === null;
  let status: PullStatus;
  if (noRpm || wotClearlyLow || gearInRange === false) {
    status = "invalid";
  } else if (pull.pedalDriven && rpmSpanOk && wot === true) {
    status = "verified";
  } else {
    status = "partial";
  }

  return {
    status,
    singleGear,
    gearValue,
    gearInRange,
    gears,
    multiGear,
    wot,
    wotCoverage,
    rpmStart,
    rpmEnd,
    rpmSpanOk,
    reasons,
  };
}

// Essential tuning parameters we expect in a logging profile. Absence isn't an
// error (the log still opens) but it blinds specific analyses, so we surface an
// actionable hint pointing at the MGflasher logging profile.
const ESSENTIAL_PARAMS: {
  key: keyof ResolvedChannels;
  label: string;
  message: string;
}[] = [
  {
    key: "stft",
    label: "Fuel Trim Short Term (STFT)",
    message:
      "Hinweis: STFT nicht im Log enthalten. Aktiviere diesen Parameter in deinem MGflasher-Logging-Profil für präzisere Gemisch-Analysen.",
  },
  {
    key: "ltft",
    label: "Fuel Trim Long Term (LTFT)",
    message:
      "Hinweis: LTFT nicht im Log enthalten. Aktiviere diesen Parameter in deinem MGflasher-Logging-Profil für präzisere Gemisch-Analysen.",
  },
  {
    key: "boostActual",
    label: "Boost Actual",
    message:
      "Hinweis: Ist-Ladedruck fehlt. Ohne ihn ist keine Boost-Analyse möglich – im Logging-Profil aktivieren.",
  },
  {
    key: "boostTarget",
    label: "Boost Target",
    message:
      "Hinweis: Soll-Ladedruck fehlt. Ohne ihn lässt sich keine Ziel-/Ist-Abweichung bewerten.",
  },
];

function findMissing(ch: ResolvedChannels): MissingParamHint[] {
  const missing: MissingParamHint[] = [];
  for (const p of ESSENTIAL_PARAMS) {
    if (ch[p.key] === null) {
      missing.push({ key: String(p.key), label: p.label, message: p.message });
    }
  }
  // Timing/knock correction is stored separately (a list).
  if (ch.timingCorrections.length === 0) {
    missing.push({
      key: "timingCorrection",
      label: "Zündwinkel-Korrektur / Knock",
      message:
        "Hinweis: Keine Zündwinkel-Korrektur/Knock-Kanäle gefunden. Aktiviere sie im Logging-Profil, um Klopfen frühzeitig zu erkennen.",
    });
  }
  return missing;
}

/** Result of the safety pass: human alerts plus their time-stamped violations. */
interface AlertResult {
  alerts: SafetyAlert[];
  violations: Violation[];
}

/** Convert a pressure reading to METRIC bar based on its logged unit. */
export function toBar(value: number, unit: string | null): number {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("mpa")) return value * 10; // 1 MPa = 10 bar
  if (u.includes("kpa")) return value / 100; // 100 kPa = 1 bar
  if (u.includes("hpa") || u.includes("mbar")) return value / 1000; // 1000 hPa = 1 bar
  if (u.includes("psi")) return value * 0.0689476;
  return value; // already bar (or unknown → assume bar)
}

function findAlerts(
  ch: ResolvedChannels,
  window: [number, number],
  limits: SpecLimits,
  time: number[],
  excluded: Set<number>,
): AlertResult {
  const [lo, hi] = window;
  const alerts: SafetyAlert[] = [];
  const violations: Violation[] = [];
  const at = (i: number): number => time[i] ?? i;
  // Gear-shift zones are excluded from safety evaluation: right after a shift the
  // boost overshoots, EGT spikes and timing pulls momentarily — all normal and
  // not a fault, so judging there would raise false alarms.
  const evaluable = (i: number): boolean => !excluded.has(i);

  // 1. Knock / timing pulls beyond threshold, on however many cylinders.
  if (ch.timingCorrections.length > 0) {
    const offenders: { label: string; worst: number; at: number }[] = [];
    for (const s of ch.timingCorrections) {
      let idx = -1;
      let worst: number | null = null;
      for (let i = lo; i <= hi; i += 1) {
        if (!evaluable(i)) continue;
        const v = s.values[i];
        if (v === null) continue;
        if (worst === null || v < worst) {
          worst = v;
          idx = i;
        }
      }
      if (worst !== null && worst <= limits.knockCorrection) {
        offenders.push({ label: s.label, worst, at: idx });
        violations.push({
          id: `knock-${s.key}`,
          severity: "critical",
          sampleIndex: idx,
          time: at(idx),
          label: `Klopfen: ${s.label}`,
          detail: `${s.label}: Zündwinkel-Korrektur ${worst.toFixed(1)}°`,
        });
      }
    }
    if (offenders.length > 0) {
      const worst = Math.min(...offenders.map((o) => o.worst));
      alerts.push({
        id: "knock",
        severity: "critical",
        title: `Klopfen erkannt: Zündwinkel-Korrektur bis ${worst.toFixed(1)}°`,
        detail:
          offenders.length > 1
            ? `Korrekturen ≤ ${limits.knockCorrection}° auf ${offenders.length} Zylindern (${offenders
                .map((o) => `${o.label}: ${o.worst.toFixed(1)}°`)
                .join(", ")}).`
            : `${offenders[0].label}: ${offenders[0].worst.toFixed(1)}°.`,
      });
    }
  }

  // 2. Boost target vs. actual deviation (leak / overboost indicator) — in bar.
  if (ch.boostTarget && ch.boostActual) {
    const tUnit = ch.boostTarget.unit;
    const aUnit = ch.boostActual.unit;
    // Deviation is only meaningful once boost has substantially built: during the
    // initial spool-up the target commands full boost while the turbo is still
    // spinning up, so the large transient gap there is normal lag, not a fault.
    // Restrict evaluation to the "on-boost" region (≥ 70 % of peak actual boost).
    let peakActBar = 0;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const a = ch.boostActual.values[i];
      if (a === null) continue;
      const ab = toBar(a, aUnit);
      if (ab > peakActBar) peakActBar = ab;
    }
    const onBoost = 0.7 * peakActBar;
    let worstGap = 0;
    let worstSigned = 0;
    let worstAt = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const t = ch.boostTarget.values[i];
      const a = ch.boostActual.values[i];
      if (t === null || a === null) continue;
      const tb = toBar(t, tUnit);
      const ab = toBar(a, aUnit);
      if (ab < onBoost) continue; // still spooling — skip
      const gap = Math.abs(tb - ab);
      if (gap > worstGap) {
        worstGap = gap;
        worstSigned = ab < tb ? -gap : gap;
        worstAt = i;
      }
    }
    if (worstGap >= limits.boostDeviation && worstAt >= 0) {
      const under = worstSigned < 0;
      alerts.push({
        id: "boost-deviation",
        severity: "warning",
        title: `Ladedruck-Abweichung ${worstGap.toFixed(2)} bar`,
        detail: under
          ? "Ist-Ladedruck bleibt hinter dem Ziel zurück – möglicher Leck-/Underboost-Indikator (z. B. Ladeluftschlauch/Wastegate)."
          : "Ist-Ladedruck überschreitet das Ziel – möglicher Overboost (Wastegate/Regelung prüfen).",
      });
      violations.push({
        id: "boost-deviation",
        severity: "warning",
        sampleIndex: worstAt,
        time: at(worstAt),
        label: "Ladedruck-Abweichung",
        detail: `Soll↔Ist ${under ? "-" : "+"}${worstGap.toFixed(2)} bar`,
      });
    }
  }

  // 3. Boost above the hardware/stage-plausible ceiling — in bar.
  if (ch.boostActual) {
    const unit = ch.boostActual.unit;
    let peak: number | null = null;
    let idx = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const v = ch.boostActual.values[i];
      if (v === null) continue;
      const bar = toBar(v, unit);
      if (peak === null || bar > peak) {
        peak = bar;
        idx = i;
      }
    }
    if (peak !== null && peak > limits.maxBoost) {
      alerts.push({
        id: "boost-limit",
        severity: "warning",
        title: `Peak Boost ${peak.toFixed(2)} bar über Grenze`,
        detail: `Über dem plausiblen Maximum (${limits.maxBoost.toFixed(2)} bar) für Turbo + Map-Stufe – Messfehler oder Overboost prüfen.`,
      });
      violations.push({
        id: "boost-limit",
        severity: "warning",
        sampleIndex: idx,
        time: at(idx),
        label: "Overboost",
        detail: `Peak ${peak.toFixed(2)} bar > ${limits.maxBoost.toFixed(2)} bar`,
      });
    }
  }

  // 4. Fuel trims (STFT/LTFT) beyond the engine's tolerance — lean/rich flag.
  for (const trim of [
    { s: ch.stft, id: "stft", label: "STFT" },
    { s: ch.ltft, id: "ltft", label: "LTFT" },
  ]) {
    if (!trim.s) continue;
    let worstMag = 0;
    let worstVal = 0;
    let worstAt = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const v = trim.s.values[i];
      if (v === null) continue;
      const mag = Math.abs(v);
      if (mag > worstMag) {
        worstMag = mag;
        worstVal = v;
        worstAt = i;
      }
    }
    if (worstMag >= limits.fuelTrimLimit && worstAt >= 0) {
      const lean = worstVal > 0;
      alerts.push({
        id: `trim-${trim.id}`,
        severity: "warning",
        title: `${trim.label} ${worstVal > 0 ? "+" : ""}${worstVal.toFixed(1)}% über Toleranz`,
        detail: `${trim.label} überschreitet ±${limits.fuelTrimLimit}% – ${
          lean ? "mageres" : "fettes"
        } Gemisch (Kraftstoffzufuhr / Sensorik prüfen).`,
      });
      violations.push({
        id: `trim-${trim.id}`,
        severity: "warning",
        sampleIndex: worstAt,
        time: at(worstAt),
        label: trim.label,
        detail: `${trim.label} ${worstVal > 0 ? "+" : ""}${worstVal.toFixed(1)}%`,
      });
    }
  }

  // 5. HPFP pressure drop (fuel starvation) — target vs. actual, or vs. floor; in bar.
  if (ch.hpfpTarget && ch.hpfpActual) {
    const tUnit = ch.hpfpTarget.unit;
    const aUnit = ch.hpfpActual.unit;
    let worstDrop = 0;
    let worstAt = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const t = ch.hpfpTarget.values[i];
      const a = ch.hpfpActual.values[i];
      if (t === null || a === null) continue;
      const drop = toBar(t, tUnit) - toBar(a, aUnit);
      if (drop > worstDrop) {
        worstDrop = drop;
        worstAt = i;
      }
    }
    if (worstDrop >= limits.hpfpDrop && worstAt >= 0) {
      alerts.push({
        id: "hpfp-drop",
        severity: "critical",
        title: `HPFP-Druckeinbruch ${worstDrop.toFixed(0)} bar`,
        detail:
          "Ist-Raildruck fällt deutlich unter das Ziel – Kraftstoffpumpe am Limit (mageres Gemisch-Risiko).",
      });
      violations.push({
        id: "hpfp-drop",
        severity: "critical",
        sampleIndex: worstAt,
        time: at(worstAt),
        label: "HPFP-Einbruch",
        detail: `Soll↔Ist -${worstDrop.toFixed(0)} bar`,
      });
    }
  } else if (ch.hpfpActual && ch.rpm) {
    // Only judge the rail-pressure floor in the high-load region: at idle / the
    // start of a pull the pump naturally sits low, so measuring there would be a
    // false positive. Restrict to the upper half of the RPM sweep.
    const aUnit = ch.hpfpActual.unit;
    const rpmEnd = maxOf(ch.rpm.values, lo, hi);
    if (rpmEnd !== null) {
      const threshold = rpmEnd * 0.5;
      let low: number | null = null;
      let lowAt = -1;
      for (let i = lo; i <= hi; i += 1) {
        if (!evaluable(i)) continue;
        const r = ch.rpm.values[i];
        const v = ch.hpfpActual.values[i];
        if (r === null || v === null || r < threshold) continue;
        const bar = toBar(v, aUnit);
        if (low === null || bar < low) {
          low = bar;
          lowAt = i;
        }
      }
      if (low !== null && low < limits.minHpfpPressure) {
        alerts.push({
          id: "hpfp-low",
          severity: "warning",
          title: `HPFP-Raildruck fällt auf ${low.toFixed(0)} bar`,
          detail: `Unter der erwarteten Mindestgrenze (${limits.minHpfpPressure} bar) für die konfigurierte Pumpe unter Last.`,
        });
        violations.push({
          id: "hpfp-low",
          severity: "warning",
          sampleIndex: lowAt,
          time: at(lowAt),
          label: "HPFP niedrig",
          detail: `${low.toFixed(0)} bar < ${limits.minHpfpPressure} bar`,
        });
      }
    }
  }

  // 6. EGT above the cat/stage-contextual ceiling (°C, already metric).
  if (ch.egt) {
    let peak: number | null = null;
    let idx = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (!evaluable(i)) continue;
      const v = ch.egt.values[i];
      if (v === null) continue;
      if (peak === null || v > peak) {
        peak = v;
        idx = i;
      }
    }
    if (peak !== null && peak > limits.maxEgt) {
      const unit = ch.egt.unit ?? "°C";
      alerts.push({
        id: "egt-limit",
        severity: "critical",
        title: `EGT ${peak.toFixed(0)} ${unit} über Limit`,
        detail: `${limits.egtRationale} Gemessenes Maximum liegt über ${limits.maxEgt} °C – Bauteilschutz beachten.`,
      });
      violations.push({
        id: "egt-limit",
        severity: "critical",
        sampleIndex: idx,
        time: at(idx),
        label: "EGT-Limit",
        detail: `${peak.toFixed(0)} ${unit} > ${limits.maxEgt} °C`,
      });
    }
  }

  return { alerts, violations };
}

/**
 * Evaluate a single log pull against a vehicle's engine & hardware spec. Pure,
 * total, and defensive: an empty or channel-less log yields an "invalid" verdict
 * rather than throwing.
 */
export function evaluateLogPull(log: ParsedLog, spec: VehicleSpec): LogPullEvaluation {
  const limits = limitsForSpec(spec);
  const ch = resolveChannels(log);
  const pull = detectPull(log, ch);
  const window = pull.window;

  const validity = evaluateValidity(ch, pull, limits);
  const missing = findMissing(ch);
  const { excluded, ranges: exclusionRanges } = computeShiftZones(log, ch.gear, window);
  const { alerts, violations } = findAlerts(ch, window, limits, log.time, excluded);

  // The pull range is only meaningful when there is a real WOT sweep to frame.
  const [lo, hi] = window;
  const pullRange: PullRange | null =
    hi > lo && log.time.length > hi ? { start: log.time[lo], end: log.time[hi] } : null;

  return { validity, missing, alerts, violations, pullRange, exclusionRanges, limits, window };
}
