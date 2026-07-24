import { resolveChannels, type ResolvedChannels } from "./channels";
import { toLambda } from "./engineProfiles";
import { toBar } from "./evaluate-log-pull";
import {
  alignLog,
  axisLabel,
  axisValueAt,
  elapsedSeconds,
  type AlignMode,
  type LogAlignment,
  type OverlayAxis,
} from "./log-align";
import type { LogSeries, ParsedLog } from "./types";

// Dual-log comparison. Two datalogs — a baseline (A) and a comparison (B), e.g.
// Stock vs. Stage 1 or Run A vs. Run B — are reduced to (a) a set of key-metric
// deltas for the diff cards and (b) an aligned overlay so both traces of one
// channel share a single X axis.
//
// Two hard problems, both solved here:
//
//   1. ANCHORING — the two pulls start at different points in their recordings.
//      Handled by log-align.ts: t = 0 is pinned to each log's own detected WOT
//      start, so the spool-ups line up.
//   2. RESAMPLING — even aligned, the two logs sample at different instants and
//      RPM points, so there is no shared X value to put in one chart row. Both
//      sides are linearly interpolated onto a common grid, which is cheap and
//      visually faithful for these monotone-ish pull traces.
//
// All metrics are computed over each log's own DETECTED PULL WINDOW, not the
// whole recording — idle, coast-down and the drive back to the start line would
// otherwise pollute every peak and average.
//
// Pure + dependency-free for unit testing.

export interface MetricDelta {
  key: string;
  label: string;
  unit: string | null;
  a: number | null;
  b: number | null;
  /** b − a, or null when either side is missing. */
  delta: number | null;
  /** Whether a higher value is "more" (purely for display, not judgement). */
  higherIsMore: boolean;
}

export interface LogComparison {
  metrics: MetricDelta[];
  /** Per-side alignment info, surfaced so the UI can flag a fallback anchor. */
  alignment: { a: LogAlignment; b: LogAlignment };
}

// ── extremum helpers (gap-tolerant, range-limited) ─────────────────────────

function maxOf(values: (number | null)[], lo = 0, hi = values.length - 1): number | null {
  let m: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (m === null || v > m) m = v;
  }
  return m;
}

/** First non-null value in [lo, hi]. */
function firstOf(values: (number | null)[], lo: number, hi: number): number | null {
  for (let i = lo; i <= hi; i += 1) {
    const v = values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Last non-null value in [lo, hi]. */
function lastOf(values: (number | null)[], lo: number, hi: number): number | null {
  for (let i = hi; i >= lo; i -= 1) {
    const v = values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Most negative correction across all cylinders at sample i, or null. */
function worstCorrectionAt(corrections: LogSeries[], i: number): number | null {
  let worst: number | null = null;
  for (const s of corrections) {
    const v = s.values[i];
    if (v === null || v === undefined) continue;
    if (worst === null || v < worst) worst = v;
  }
  return worst;
}

// ── per-side metric extraction ─────────────────────────────────────────────

/**
 * Fraction of peak commanded boost that counts as "spooled". Real boost control
 * approaches its target asymptotically and often settles a few percent under it,
 * so requiring actual ≥ target exactly would report "never spooled" on healthy
 * logs. 95 % is past the knee of the ramp on every reference log.
 */
const SPOOL_TARGET_FRAC = 0.95;

interface SideMetrics {
  peakBoost: number | null;
  boostUnit: string | null;
  /** Seconds from the WOT anchor until boost first reaches the spool threshold. */
  spoolTime: number | null;
  /** Engine speed at that same moment. */
  spoolRpm: number | null;
  maxIat: number | null;
  /** IAT at the end of the pull minus IAT at its start (heat-soak ramp). */
  iatRamp: number | null;
  iatUnit: string | null;
  /** Most negative timing correction seen on any cylinder. */
  worstCorrection: number | null;
  /** Mean of the per-sample worst correction across the pull (severity). */
  avgCorrection: number | null;
  correctionUnit: string | null;
  maxRpm: number | null;
}

function sideMetrics(log: ParsedLog, ch: ResolvedChannels, alignment: LogAlignment): SideMetrics {
  const lo = alignment.startIndex;
  const hi = Math.max(lo, alignment.endIndex);

  // ── Boost ──
  const peakBoost = ch.boostActual ? maxOf(ch.boostActual.values, lo, hi) : log.meta.peakBoost;
  const boostUnit = ch.boostActual?.unit ?? log.meta.peakBoostUnit ?? null;

  // ── Spool-up: time & RPM to reach (95 % of) commanded boost ──
  // Judged against the TARGET trace when logged — that is the boost the tune
  // asked for — and against the run's own peak when it isn't.
  let spoolTime: number | null = null;
  let spoolRpm: number | null = null;
  if (ch.boostActual) {
    const actual = ch.boostActual;
    const reference = ch.boostTarget ?? actual;
    const peakRefRaw = maxOf(reference.values, lo, hi);
    if (peakRefRaw !== null) {
      const threshold = toBar(peakRefRaw, reference.unit) * SPOOL_TARGET_FRAC;
      for (let i = lo; i <= hi; i += 1) {
        const v = actual.values[i];
        if (v === null || v === undefined) continue;
        if (toBar(v, actual.unit) >= threshold) {
          spoolTime = elapsedSeconds(log, alignment, i);
          spoolRpm = ch.rpm ? ch.rpm.values[i] ?? null : null;
          break;
        }
      }
    }
  }

  // ── IAT: peak and ramp across the pull ──
  const maxIat = ch.iat ? maxOf(ch.iat.values, lo, hi) : null;
  const iatStart = ch.iat ? firstOf(ch.iat.values, lo, hi) : null;
  const iatEnd = ch.iat ? lastOf(ch.iat.values, lo, hi) : null;
  const iatRamp = iatStart === null || iatEnd === null ? null : iatEnd - iatStart;

  // ── Timing-pull severity: worst single reading and sustained average ──
  let worstCorrection: number | null = null;
  let corrSum = 0;
  let corrCount = 0;
  if (ch.timingCorrections.length > 0) {
    for (let i = lo; i <= hi; i += 1) {
      const w = worstCorrectionAt(ch.timingCorrections, i);
      if (w === null) continue;
      if (worstCorrection === null || w < worstCorrection) worstCorrection = w;
      corrSum += w;
      corrCount += 1;
    }
  }
  const avgCorrection = corrCount > 0 ? corrSum / corrCount : null;

  return {
    peakBoost,
    boostUnit,
    spoolTime,
    spoolRpm,
    maxIat,
    iatRamp,
    iatUnit: ch.iat?.unit ?? null,
    worstCorrection,
    avgCorrection,
    correctionUnit: ch.timingCorrections[0]?.unit ?? null,
    maxRpm: log.meta.maxRpm,
  };
}

/** Compute the key-metric deltas shown on the comparison diff cards. */
export function compareLogs(a: ParsedLog, b: ParsedLog): LogComparison {
  const ca = resolveChannels(a);
  const cb = resolveChannels(b);
  const alignA = alignLog(a, ca);
  const alignB = alignLog(b, cb);
  const ma = sideMetrics(a, ca, alignA);
  const mb = sideMetrics(b, cb, alignB);

  const delta = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : y - x;

  const metric = (
    key: string,
    label: string,
    unit: string | null,
    pick: (m: SideMetrics) => number | null,
    higherIsMore = true,
  ): MetricDelta => ({
    key,
    label,
    unit,
    a: pick(ma),
    b: pick(mb),
    delta: delta(pick(ma), pick(mb)),
    higherIsMore,
  });

  const metrics: MetricDelta[] = [
    metric("peakBoost", "Peak Boost", ma.boostUnit ?? mb.boostUnit ?? "psi", (m) => m.peakBoost),
    metric("spoolTime", "Spool-Up (Zeit)", "s", (m) => m.spoolTime, false),
    metric("spoolRpm", "Spool-Up (Drehzahl)", "rpm", (m) => m.spoolRpm, false),
    metric(
      "worstCorrection",
      "Max Zündwinkel-Korrektur",
      ma.correctionUnit ?? mb.correctionUnit ?? "°",
      (m) => m.worstCorrection,
      // A larger pull is a more-negative number; display-only flag.
      false,
    ),
    metric(
      "avgCorrection",
      "Ø Zündwinkel-Korrektur",
      ma.correctionUnit ?? mb.correctionUnit ?? "°",
      (m) => m.avgCorrection,
      false,
    ),
    metric("maxIat", "Max IAT", ma.iatUnit ?? mb.iatUnit ?? "°C", (m) => m.maxIat),
    metric("iatRamp", "IAT-Anstieg", ma.iatUnit ?? mb.iatUnit ?? "°C", (m) => m.iatRamp, false),
    metric("maxRpm", "Max RPM", null, (m) => m.maxRpm),
  ];

  return { metrics, alignment: { a: alignA, b: alignB } };
}

// ── Overlay ────────────────────────────────────────────────────────────────

/** The channels that can be overlaid, in picker order. */
export type OverlayChannel =
  | "boost"
  | "ignitionTiming"
  | "timingCorrection"
  | "iat"
  | "lambda"
  | "egt"
  | "wgdc"
  | "rpm";

/** A plottable value stream — either a real channel or one synthesised here. */
interface Trace {
  values: (number | null)[];
  unit: string | null;
}

interface ChannelDef {
  label: string;
  /** The primary trace (solid for A, dashed for B). */
  pick: (ch: ResolvedChannels) => Trace | null;
  /** An optional companion trace plotted alongside, e.g. Boost Target. */
  ref?: { label: string; pick: (ch: ResolvedChannels) => Trace | null };
  /** Normalisation applied to every sample (e.g. AFR → λ). */
  transform?: (value: number, trace: Trace) => number;
  /** Unit override once transformed. */
  unitOf?: (trace: Trace | null) => string | null;
}

/** Per-sample worst (most negative) correction, as one synthetic trace. */
function worstCorrectionTrace(ch: ResolvedChannels): Trace | null {
  const corr = ch.timingCorrections;
  if (corr.length === 0) return null;
  const len = corr[0].values.length;
  const values: (number | null)[] = new Array(len);
  for (let i = 0; i < len; i += 1) values[i] = worstCorrectionAt(corr, i);
  return { values, unit: corr[0].unit ?? "°" };
}

export const OVERLAY_CHANNELS: Record<OverlayChannel, ChannelDef> = {
  // Boost is the one channel where target and actual belong on the same plot:
  // the gap between them IS the diagnosis (lag, underboost, overboost).
  boost: {
    label: "Boost",
    pick: (ch) => ch.boostActual,
    ref: { label: "Target", pick: (ch) => ch.boostTarget },
  },
  ignitionTiming: { label: "Zündwinkel", pick: (ch) => ch.ignitionTiming },
  timingCorrection: { label: "Zündwinkel-Korrektur", pick: worstCorrectionTrace },
  iat: { label: "IAT", pick: (ch) => ch.iat },
  lambda: {
    label: "Lambda",
    pick: (ch) => ch.lambda,
    // Logs carry either λ or AFR; normalise so the two sides are comparable
    // even when the base log is AFR and the compare log is λ.
    transform: (v, trace) => toLambda(v, trace.unit),
    unitOf: () => "λ",
  },
  egt: { label: "EGT", pick: (ch) => ch.egt },
  wgdc: { label: "WGDC", pick: (ch) => ch.wgdc },
  rpm: { label: "RPM", pick: (ch) => ch.rpm },
};

export interface OverlayPoint {
  /** Shared X value (elapsed seconds or RPM). */
  x: number;
  /** Baseline (Log A) value at x, or null. */
  a: number | null;
  /** Comparison (Log B) value at x, or null. */
  b: number | null;
  /** Log A companion trace (e.g. Boost Target), when the channel has one. */
  aRef?: number | null;
  /** Log B companion trace. */
  bRef?: number | null;
}

export interface OverlaySeries {
  points: OverlayPoint[];
  /** Which quantity the X axis carries — drives tick formatting downstream. */
  axis: OverlayAxis;
  /** X-axis label incl. unit ("RPM", "t − WOT (s)"). */
  xLabel: string;
  /** Y unit of the overlaid channel, if known. */
  unit: string | null;
  /** Whether `aRef`/`bRef` carry data (drives the extra chart lines + legend). */
  hasRef: boolean;
  /** Legend label of the companion trace, when present. */
  refLabel: string | null;
  /** True when either side's anchor fell back to the RPM sweep (no pedal). */
  approximateAlignment: boolean;
}

export interface OverlayOptions {
  axis?: OverlayAxis;
  align?: AlignMode;
  gridSize?: number;
}

const DEFAULT_GRID = 160;

/** (x, y) pairs for one trace over [lo, hi], sorted ascending by x. */
function pairsFor(
  trace: Trace | null,
  xAt: (i: number) => number | null,
  lo: number,
  hi: number,
  transform?: (value: number, trace: Trace) => number,
): { x: number; y: number }[] {
  if (!trace) return [];
  const pairs: { x: number; y: number }[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const x = xAt(i);
    const raw = trace.values[i];
    if (x === null || raw === null || raw === undefined) continue;
    pairs.push({ x, y: transform ? transform(raw, trace) : raw });
  }
  pairs.sort((p, q) => p.x - q.x);
  return pairs;
}

/** Linear-interpolate a value at `x` from sorted (x, y) pairs; null if outside. */
function interpolate(pairs: { x: number; y: number }[], x: number): number | null {
  if (pairs.length === 0) return null;
  if (x < pairs[0].x || x > pairs[pairs.length - 1].x) return null;
  // Binary search for the bracketing segment.
  let lo = 0;
  let hi = pairs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const p = pairs[lo];
  const q = pairs[hi];
  if (q.x === p.x) return p.y;
  const t = (x - p.x) / (q.x - p.x);
  return p.y + t * (q.y - p.y);
}

function rangeOf(...sets: { x: number; y: number }[][]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const pairs of sets) {
    if (pairs.length === 0) continue;
    if (pairs[0].x < lo) lo = pairs[0].x;
    if (pairs[pairs.length - 1].x > hi) hi = pairs[pairs.length - 1].x;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return [lo, hi];
}

/**
 * Resample one channel of both logs onto a shared X grid so the overlay chart
 * can plot them together with a single synchronized cursor.
 *
 * The grid spans the UNION of both ranges, so neither trace is truncated —
 * grid points outside a given log's own range interpolate to null on that side
 * only, and the chart simply draws no segment there.
 *
 * Sample scope depends on the axis: the RPM axis is restricted to each log's
 * detected pull window, because engine speed is only monotone within a pull
 * (a whole recording revisits the same RPM on every gear and coast-down, which
 * would fold unrelated samples onto the same X). The time axis keeps the full
 * recording so the approach into boost stays visible.
 */
export function buildOverlay(
  a: ParsedLog,
  b: ParsedLog,
  channel: OverlayChannel,
  options: OverlayOptions = {},
): OverlaySeries {
  const { axis = "rpm", align = "wot", gridSize = DEFAULT_GRID } = options;
  const def = OVERLAY_CHANNELS[channel];
  const ca = resolveChannels(a);
  const cb = resolveChannels(b);
  const alignA = alignLog(a, ca);
  const alignB = alignLog(b, cb);

  const traceA = def.pick(ca);
  const traceB = def.pick(cb);
  const refA = def.ref?.pick(ca) ?? null;
  const refB = def.ref?.pick(cb) ?? null;

  const unit = def.unitOf
    ? def.unitOf(traceA ?? traceB)
    : traceA?.unit ?? traceB?.unit ?? null;
  const xLabel = axisLabel(a, axis, align);
  const approximateAlignment =
    align === "wot" && axis === "time" && (!alignA.pedalDriven || !alignB.pedalDriven);

  const empty: OverlaySeries = {
    points: [],
    axis,
    xLabel,
    unit,
    hasRef: false,
    refLabel: def.ref?.label ?? null,
    approximateAlignment,
  };
  if (!traceA && !traceB) return empty;

  const scope = (log: ParsedLog, alignment: LogAlignment): [number, number] =>
    axis === "rpm"
      ? [alignment.startIndex, Math.max(alignment.startIndex, alignment.endIndex)]
      : [0, log.time.length - 1];

  const [loA, hiA] = scope(a, alignA);
  const [loB, hiB] = scope(b, alignB);
  const xA = axisValueAt(a, ca, alignA, axis, align);
  const xB = axisValueAt(b, cb, alignB, axis, align);

  const pairsA = pairsFor(traceA, xA, loA, hiA, def.transform);
  const pairsB = pairsFor(traceB, xB, loB, hiB, def.transform);
  const pairsRefA = pairsFor(refA, xA, loA, hiA, def.transform);
  const pairsRefB = pairsFor(refB, xB, loB, hiB, def.transform);

  const range = rangeOf(pairsA, pairsB, pairsRefA, pairsRefB);
  if (!range) return empty;
  const [lo, hi] = range;

  const hasRef = pairsRefA.length > 0 || pairsRefB.length > 0;
  const steps = Math.max(2, gridSize);
  const points: OverlayPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const x = lo + ((hi - lo) * i) / (steps - 1);
    // RPM is an integer quantity; elapsed seconds need sub-step precision.
    const xOut = axis === "rpm" ? Math.round(x) : Math.round(x * 1000) / 1000;
    const point: OverlayPoint = {
      x: xOut,
      a: interpolate(pairsA, x),
      b: interpolate(pairsB, x),
    };
    if (hasRef) {
      point.aRef = interpolate(pairsRefA, x);
      point.bRef = interpolate(pairsRefB, x);
    }
    points.push(point);
  }

  return {
    points,
    axis,
    xLabel,
    unit,
    hasRef,
    refLabel: def.ref?.label ?? null,
    approximateAlignment,
  };
}
