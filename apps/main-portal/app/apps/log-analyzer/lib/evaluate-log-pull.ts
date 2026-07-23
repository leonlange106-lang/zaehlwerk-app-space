import { resolveChannels, type ResolvedChannels } from "./channels";
import type { LogSeries, ParsedLog } from "./types";
import { limitsForSpec, type SpecLimits, type VehicleSpec } from "./vehicle-spec";

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
/** Gears that count as a valid comparison/dyno pull. */
const DYNO_GEARS = new Set([3, 4]);

export type PullStatus = "verified" | "partial" | "invalid";

export interface PullValidity {
  status: PullStatus;
  /** Constant gear (no shift) across the pull window — null if no gear channel. */
  singleGear: boolean | null;
  gearValue: number | null;
  /** Whether the constant gear is a valid dyno gear (3/4). Null if unknown. */
  gearInRange: boolean | null;
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

/** The verified-pull window expressed on the chart's X axis. */
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
 * Detect the pull window: from the RPM low point that precedes peak RPM up to
 * the peak. This isolates the acceleration sweep from any idle/coast around it.
 * Falls back to the full sample range when there is no usable RPM channel.
 */
function detectWindow(log: ParsedLog, rpm: LogSeries | null): [number, number] {
  const last = log.time.length - 1;
  if (last < 0) return [0, 0];
  if (!rpm) return [0, last];
  const peak = argMax(rpm.values, 0, last);
  if (peak <= 0) return [0, last];
  const start = argMin(rpm.values, 0, peak);
  return [start < 0 ? 0 : start, peak];
}

function evaluateValidity(
  ch: ResolvedChannels,
  window: [number, number],
  limits: SpecLimits,
): PullValidity {
  const [lo, hi] = window;
  const reasons: string[] = [];

  // ── RPM span ──
  const rpmStart = ch.rpm ? ch.rpm.values[lo] ?? minOf(ch.rpm.values, lo, hi) : null;
  const rpmEnd = ch.rpm ? maxOf(ch.rpm.values, lo, hi) : null;
  const rpmSpanOk =
    rpmStart !== null &&
    rpmEnd !== null &&
    rpmStart <= limits.rpmStartMax &&
    rpmEnd >= limits.rpmEndMin;
  if (ch.rpm && !rpmSpanOk) {
    reasons.push(
      `Drehzahlfenster unzureichend (Start ${rpmStart ?? "?"} → Ende ${rpmEnd ?? "?"} RPM; erwartet ≤ ${limits.rpmStartMax} bis ≥ ${limits.rpmEndMin}).`,
    );
  } else if (!ch.rpm) {
    reasons.push("Kein RPM-Kanal gefunden – Pull-Umfang nicht verifizierbar.");
  }

  // ── Single gear + dyno-gear (3/4) check ──
  let singleGear: boolean | null = null;
  let gearValue: number | null = null;
  let gearInRange: boolean | null = null;
  if (ch.gear) {
    const gMin = minOf(ch.gear.values, lo, hi);
    const gMax = maxOf(ch.gear.values, lo, hi);
    if (gMin !== null && gMax !== null) {
      singleGear = gMin === gMax;
      gearValue = singleGear ? gMin : null;
      if (!singleGear) {
        reasons.push(`Schaltvorgang im Pull erkannt (Gang ${gMin} → ${gMax}).`);
      } else {
        gearInRange = DYNO_GEARS.has(gearValue as number);
        if (!gearInRange) {
          reasons.push(`Pull nicht im Vergleichsgang (Gang ${gearValue}; erwartet 3 oder 4).`);
        }
      }
    }
  }

  // ── WOT / throttle ──
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
    reasons.push("Kein Pedal-/Throttle-Kanal – Volllast nicht verifizierbar.");
  }

  // ── Status roll-up ──
  // A shift, near-zero throttle, or no RPM channel at all means we can't call it
  // a valid pull. A clean full sweep + WOT + single dyno gear (3/4) is verified;
  // the in-between (short sweep, wrong gear, unknown throttle) is partial.
  const shifted = singleGear === false;
  const wotClearlyLow = wotCoverage !== null && wotCoverage < WOT_COVERAGE_MIN;
  const noRpm = ch.rpm === null;
  let status: PullStatus;
  if (shifted || wotClearlyLow || noRpm) {
    status = "invalid";
  } else if (rpmSpanOk && wot === true && singleGear !== false && gearInRange !== false) {
    status = "verified";
  } else {
    status = "partial";
  }

  return {
    status,
    singleGear,
    gearValue,
    gearInRange,
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

function findAlerts(
  ch: ResolvedChannels,
  window: [number, number],
  limits: SpecLimits,
  time: number[],
): AlertResult {
  const [lo, hi] = window;
  const alerts: SafetyAlert[] = [];
  const violations: Violation[] = [];
  const at = (i: number): number => time[i] ?? i;

  // 1. Knock / timing pulls beyond threshold, on however many cylinders.
  if (ch.timingCorrections.length > 0) {
    const offenders: { label: string; worst: number; at: number }[] = [];
    for (const s of ch.timingCorrections) {
      const idx = argMin(s.values, lo, hi); // most-negative correction
      const worst = idx >= 0 ? s.values[idx] : null;
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

  // 2. Boost target vs. actual deviation (leak / overboost indicator).
  if (ch.boostTarget && ch.boostActual) {
    let worstGap = 0;
    let worstSigned = 0;
    let worstAt = -1;
    for (let i = lo; i <= hi; i += 1) {
      const t = ch.boostTarget.values[i];
      const a = ch.boostActual.values[i];
      if (t === null || a === null) continue;
      const gap = Math.abs(t - a);
      if (gap > worstGap) {
        worstGap = gap;
        worstSigned = a < t ? -gap : gap;
        worstAt = i;
      }
    }
    if (worstGap >= limits.boostDeviation && worstAt >= 0) {
      const under = worstSigned < 0;
      const unit = ch.boostActual.unit ?? "psi";
      alerts.push({
        id: "boost-deviation",
        severity: "warning",
        title: `Ladedruck-Abweichung ${worstGap.toFixed(1)} ${unit}`,
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
        detail: `Soll↔Ist ${under ? "-" : "+"}${worstGap.toFixed(1)} ${unit}`,
      });
    }
  }

  // 3. Boost above the hardware-plausible ceiling.
  if (ch.boostActual) {
    const idx = argMax(ch.boostActual.values, lo, hi);
    const peak = idx >= 0 ? ch.boostActual.values[idx] : null;
    if (peak !== null && peak > limits.maxBoost) {
      const unit = ch.boostActual.unit ?? "psi";
      alerts.push({
        id: "boost-limit",
        severity: "warning",
        title: `Peak Boost ${peak.toFixed(1)} ${unit} über Hardware-Grenze`,
        detail: `Über dem plausiblen Maximum (${limits.maxBoost} psi) für den konfigurierten Turbo – Messfehler oder Overboost prüfen.`,
      });
      violations.push({
        id: "boost-limit",
        severity: "warning",
        sampleIndex: idx,
        time: at(idx),
        label: "Overboost",
        detail: `Peak ${peak.toFixed(1)} ${unit} > ${limits.maxBoost} ${unit}`,
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

  // 5. HPFP pressure drop (fuel starvation) — target vs. actual, or vs. floor.
  if (ch.hpfpTarget && ch.hpfpActual) {
    let worstDrop = 0;
    let worstAt = -1;
    for (let i = lo; i <= hi; i += 1) {
      const t = ch.hpfpTarget.values[i];
      const a = ch.hpfpActual.values[i];
      if (t === null || a === null) continue;
      const drop = t - a;
      if (drop > worstDrop) {
        worstDrop = drop;
        worstAt = i;
      }
    }
    if (worstDrop >= limits.hpfpDrop && worstAt >= 0) {
      const unit = ch.hpfpActual.unit ?? "bar";
      alerts.push({
        id: "hpfp-drop",
        severity: "critical",
        title: `HPFP-Druckeinbruch ${worstDrop.toFixed(0)} ${unit}`,
        detail:
          "Ist-Raildruck fällt deutlich unter das Ziel – Kraftstoffpumpe am Limit (mageres Gemisch-Risiko).",
      });
      violations.push({
        id: "hpfp-drop",
        severity: "critical",
        sampleIndex: worstAt,
        time: at(worstAt),
        label: "HPFP-Einbruch",
        detail: `Soll↔Ist -${worstDrop.toFixed(0)} ${unit}`,
      });
    }
  } else if (ch.hpfpActual && ch.rpm) {
    // Only judge the rail-pressure floor in the high-load region: at idle / the
    // start of a pull the pump naturally sits low, so measuring there would be a
    // false positive. Restrict to the upper half of the RPM sweep.
    const rpmEnd = maxOf(ch.rpm.values, lo, hi);
    if (rpmEnd !== null) {
      const threshold = rpmEnd * 0.5;
      let low: number | null = null;
      let lowAt = -1;
      for (let i = lo; i <= hi; i += 1) {
        const r = ch.rpm.values[i];
        const v = ch.hpfpActual.values[i];
        if (r === null || v === null || r < threshold) continue;
        if (low === null || v < low) {
          low = v;
          lowAt = i;
        }
      }
      if (low !== null && low < limits.minHpfpPressure) {
        const unit = ch.hpfpActual.unit ?? "bar";
        alerts.push({
          id: "hpfp-low",
          severity: "warning",
          title: `HPFP-Raildruck fällt auf ${low.toFixed(0)} ${unit}`,
          detail: `Unter der erwarteten Mindestgrenze (${limits.minHpfpPressure} bar) für die konfigurierte Pumpe unter Last.`,
        });
        violations.push({
          id: "hpfp-low",
          severity: "warning",
          sampleIndex: lowAt,
          time: at(lowAt),
          label: "HPFP niedrig",
          detail: `${low.toFixed(0)} ${unit} < ${limits.minHpfpPressure} bar`,
        });
      }
    }
  }

  // 6. EGT above the cat-contextual ceiling.
  if (ch.egt) {
    const idx = argMax(ch.egt.values, lo, hi);
    const peak = idx >= 0 ? ch.egt.values[idx] : null;
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
  const window = detectWindow(log, ch.rpm);

  const validity = evaluateValidity(ch, window, limits);
  const missing = findMissing(ch);
  const { alerts, violations } = findAlerts(ch, window, limits, log.time);

  // The pull range is only meaningful when there is a real RPM sweep to frame.
  const [lo, hi] = window;
  const pullRange: PullRange | null =
    ch.rpm && hi > lo && log.time.length > hi
      ? { start: log.time[lo], end: log.time[hi] }
      : null;

  return { validity, missing, alerts, violations, pullRange, limits, window };
}
