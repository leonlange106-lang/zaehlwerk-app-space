import { resolveChannels, type ResolvedChannels } from "./channels";
import type { LogSeries, ParsedLog } from "./types";
import { limitsForSpec, type SpecLimits, type VehicleSpec } from "./vehicle-spec";

// The automated log-pull evaluation engine — the analytical heart of Phase 8.1.
// Given a parsed log and the vehicle's hardware spec it answers three questions,
// each decoupled from the UI so it can be exhaustively unit-tested:
//
//   1. Is this even a valid WOT pull? (single gear, full throttle, enough RPM)
//   2. Are the parameters needed for a real analysis actually logged?
//   3. Are there safety/health red flags? (knock, boost deviation, fuel starve,
//      EGT over the hardware-contextual limit)
//
// Everything here is pure: no DOM, no storage, no framework. `evaluateLogPull`
// is the single public entry point.

// ── Thresholds (documented so they can be tuned with intent) ───────────────
/** Throttle percentage at/above which a sample counts as Wide-Open-Throttle. */
const WOT_THRESHOLD = 95;
/** A pull must begin no later than this RPM to count as a full sweep. */
const RPM_START_MAX = 2500;
/** A pull must reach at least this RPM to count as a full sweep. */
const RPM_END_MIN = 6000;
/** Fraction of the pull window that must be WOT for a clean "wot" verdict. */
const WOT_COVERAGE_OK = 0.9;
/** Below this WOT fraction the pull is considered invalid (not a real pull). */
const WOT_COVERAGE_MIN = 0.5;
/** Timing correction (deg) at/beyond which we raise a knock alert (negative). */
const KNOCK_CORRECTION_DEG = -3;
/** Boost target↔actual gap (psi) beyond which we flag a deviation. */
const BOOST_DEVIATION_PSI = 2;
/** HPFP target↔actual pressure drop (bar) beyond which we flag fuel starvation. */
const HPFP_DROP_BAR = 15;

export type PullStatus = "verified" | "partial" | "invalid";

export interface PullValidity {
  status: PullStatus;
  /** Constant gear (no shift) across the pull window — null if no gear channel. */
  singleGear: boolean | null;
  gearValue: number | null;
  /** True when throttle stays ≥ WOT threshold across the window. Null if unknown. */
  wot: boolean | null;
  /** Fraction [0..1] of the window at WOT, or null when no throttle channel. */
  wotCoverage: number | null;
  rpmStart: number | null;
  rpmEnd: number | null;
  /** True when the RPM sweep spans ≤ RPM_START_MAX … ≥ RPM_END_MIN. */
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

export interface LogPullEvaluation {
  validity: PullValidity;
  missing: MissingParamHint[];
  alerts: SafetyAlert[];
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
  log: ParsedLog,
  ch: ResolvedChannels,
  window: [number, number],
): PullValidity {
  const [lo, hi] = window;
  const reasons: string[] = [];

  // ── RPM span ──
  const rpmStart = ch.rpm ? ch.rpm.values[lo] ?? minOf(ch.rpm.values, lo, hi) : null;
  const rpmEnd = ch.rpm ? maxOf(ch.rpm.values, lo, hi) : null;
  const rpmSpanOk =
    rpmStart !== null && rpmEnd !== null && rpmStart <= RPM_START_MAX && rpmEnd >= RPM_END_MIN;
  if (ch.rpm && !rpmSpanOk) {
    reasons.push(
      `Drehzahlfenster unzureichend (Start ${rpmStart ?? "?"} → Ende ${rpmEnd ?? "?"} RPM; erwartet ≤ ${RPM_START_MAX} bis ≥ ${RPM_END_MIN}).`,
    );
  } else if (!ch.rpm) {
    reasons.push("Kein RPM-Kanal gefunden – Pull-Umfang nicht verifizierbar.");
  }

  // ── Single gear ──
  let singleGear: boolean | null = null;
  let gearValue: number | null = null;
  if (ch.gear) {
    const gMin = minOf(ch.gear.values, lo, hi);
    const gMax = maxOf(ch.gear.values, lo, hi);
    if (gMin !== null && gMax !== null) {
      singleGear = gMin === gMax;
      gearValue = singleGear ? gMin : null;
      if (!singleGear) {
        reasons.push(`Schaltvorgang im Pull erkannt (Gang ${gMin} → ${gMax}).`);
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
      if (v >= WOT_THRESHOLD) open += 1;
    }
    if (total > 0) {
      wotCoverage = open / total;
      wot = wotCoverage >= WOT_COVERAGE_OK;
      if (!wot) {
        reasons.push(
          `Kein durchgängiger Volllastbereich (nur ${Math.round(wotCoverage * 100)}% ≥ ${WOT_THRESHOLD}% Pedal).`,
        );
      }
    }
  } else {
    reasons.push("Kein Pedal-/Throttle-Kanal – Volllast nicht verifizierbar.");
  }

  // ── Status roll-up ──
  // A shift, near-zero throttle, or no RPM channel at all means we can't call it
  // a valid pull. Everything with a clean full sweep + WOT + single gear is
  // verified; the in-between (short sweep, unknown throttle, …) is partial.
  const shifted = singleGear === false;
  const wotClearlyLow = wotCoverage !== null && wotCoverage < WOT_COVERAGE_MIN;
  const noRpm = ch.rpm === null;
  let status: PullStatus;
  if (shifted || wotClearlyLow || noRpm) {
    status = "invalid";
  } else if (rpmSpanOk && wot === true && singleGear !== false) {
    status = "verified";
  } else {
    status = "partial";
  }

  return { status, singleGear, gearValue, wot, wotCoverage, rpmStart, rpmEnd, rpmSpanOk, reasons };
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

function findAlerts(
  ch: ResolvedChannels,
  window: [number, number],
  limits: SpecLimits,
): SafetyAlert[] {
  const [lo, hi] = window;
  const alerts: SafetyAlert[] = [];

  // 1. Knock / timing pulls beyond threshold, on however many cylinders.
  if (ch.timingCorrections.length > 0) {
    const offenders: { label: string; worst: number }[] = [];
    for (const s of ch.timingCorrections) {
      const worst = minOf(s.values, lo, hi); // most-negative correction
      if (worst !== null && worst <= KNOCK_CORRECTION_DEG) {
        offenders.push({ label: s.label, worst });
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
            ? `Korrekturen ≤ ${KNOCK_CORRECTION_DEG}° auf ${offenders.length} Zylindern (${offenders
                .map((o) => `${o.label}: ${o.worst.toFixed(1)}°`)
                .join(", ")}).`
            : `${offenders[0].label}: ${offenders[0].worst.toFixed(1)}°.`,
      });
    }
  }

  // 2. Boost target vs. actual deviation (leak / overboost indicator).
  if (ch.boostTarget && ch.boostActual) {
    let worstGap = 0;
    let worstAt: number | null = null;
    for (let i = lo; i <= hi; i += 1) {
      const t = ch.boostTarget.values[i];
      const a = ch.boostActual.values[i];
      if (t === null || a === null) continue;
      const gap = Math.abs(t - a);
      if (gap > worstGap) {
        worstGap = gap;
        worstAt = a < t ? -gap : gap;
      }
    }
    if (worstGap >= BOOST_DEVIATION_PSI && worstAt !== null) {
      const under = worstAt < 0;
      alerts.push({
        id: "boost-deviation",
        severity: "warning",
        title: `Ladedruck-Abweichung ${worstGap.toFixed(1)} ${ch.boostActual.unit ?? "psi"}`,
        detail: under
          ? "Ist-Ladedruck bleibt hinter dem Ziel zurück – möglicher Leck-/Undertboost-Indikator (z. B. Ladeluftschlauch/Wastegate)."
          : "Ist-Ladedruck überschreitet das Ziel – möglicher Overboost (Wastegate/Regelung prüfen).",
      });
    }
  }

  // 3. Boost above the hardware-plausible ceiling.
  if (ch.boostActual) {
    const peak = maxOf(ch.boostActual.values, lo, hi);
    if (peak !== null && peak > limits.maxBoost) {
      alerts.push({
        id: "boost-limit",
        severity: "warning",
        title: `Peak Boost ${peak.toFixed(1)} ${ch.boostActual.unit ?? "psi"} über Hardware-Grenze`,
        detail: `Über dem plausiblen Maximum (${limits.maxBoost} psi) für den konfigurierten Turbo – Messfehler oder Overboost prüfen.`,
      });
    }
  }

  // 4. HPFP pressure drop (fuel starvation) — target vs. actual, or vs. floor.
  if (ch.hpfpTarget && ch.hpfpActual) {
    let worstDrop = 0;
    for (let i = lo; i <= hi; i += 1) {
      const t = ch.hpfpTarget.values[i];
      const a = ch.hpfpActual.values[i];
      if (t === null || a === null) continue;
      const drop = t - a;
      if (drop > worstDrop) worstDrop = drop;
    }
    if (worstDrop >= HPFP_DROP_BAR) {
      alerts.push({
        id: "hpfp-drop",
        severity: "critical",
        title: `HPFP-Druckeinbruch ${worstDrop.toFixed(0)} ${ch.hpfpActual.unit ?? "bar"}`,
        detail:
          "Ist-Raildruck fällt deutlich unter das Ziel – Kraftstoffpumpe am Limit (mageres Gemisch-Risiko).",
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
      for (let i = lo; i <= hi; i += 1) {
        const r = ch.rpm.values[i];
        const v = ch.hpfpActual.values[i];
        if (r === null || v === null || r < threshold) continue;
        if (low === null || v < low) low = v;
      }
      if (low !== null && low < limits.minHpfpPressure) {
        alerts.push({
          id: "hpfp-low",
          severity: "warning",
          title: `HPFP-Raildruck fällt auf ${low.toFixed(0)} ${ch.hpfpActual.unit ?? "bar"}`,
          detail: `Unter der erwarteten Mindestgrenze (${limits.minHpfpPressure} bar) für die konfigurierte Pumpe unter Last.`,
        });
      }
    }
  }

  // 5. EGT above the cat-contextual ceiling.
  if (ch.egt) {
    const peak = maxOf(ch.egt.values, lo, hi);
    if (peak !== null && peak > limits.maxEgt) {
      alerts.push({
        id: "egt-limit",
        severity: "critical",
        title: `EGT ${peak.toFixed(0)} ${ch.egt.unit ?? "°C"} über Limit`,
        detail: `${limits.egtRationale} Gemessenes Maximum liegt über ${limits.maxEgt} °C – Bauteilschutz beachten.`,
      });
    }
  }

  return alerts;
}

/**
 * Evaluate a single log pull against a vehicle's hardware spec. Pure, total, and
 * defensive: an empty or channel-less log yields an "invalid" verdict rather
 * than throwing.
 */
export function evaluateLogPull(log: ParsedLog, spec: VehicleSpec): LogPullEvaluation {
  const limits = limitsForSpec(spec);
  const ch = resolveChannels(log);
  const window = detectWindow(log, ch.rpm);

  const validity = evaluateValidity(log, ch, window);
  const missing = findMissing(ch);
  const alerts = findAlerts(ch, window, limits);

  return { validity, missing, alerts, limits, window };
}
