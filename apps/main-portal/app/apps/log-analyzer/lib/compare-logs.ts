import { resolveChannels } from "./channels";
import type { LogSeries, ParsedLog } from "./types";

// Dual-log comparison. Two datalogs — a baseline (A) and a comparison (B) — are
// reduced to (a) a set of key-metric deltas for the diff cards and (b) an
// RPM-aligned overlay so both traces of one channel share a single X axis.
//
// The overlay's hard problem is that the two logs are sampled at different RPM
// points; we solve it by resampling both onto a common RPM grid via linear
// interpolation, which is cheap and visually faithful for these monotone-ish
// pull traces. Pure + dependency-free for unit testing.

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
}

function maxOf(values: (number | null)[]): number | null {
  let m: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (m === null || v > m) m = v;
  }
  return m;
}

function minOf(values: (number | null)[]): number | null {
  let m: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (m === null || v < m) m = v;
  }
  return m;
}

/** Compute the key-metric deltas shown on the comparison diff cards. */
export function compareLogs(a: ParsedLog, b: ParsedLog): LogComparison {
  const ca = resolveChannels(a);
  const cb = resolveChannels(b);

  const delta = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : y - x;

  // Peak boost: prefer the resolved actual-boost channel, fall back to meta.
  const peakBoostA = ca.boostActual ? ca.boostActual.max : a.meta.peakBoost;
  const peakBoostB = cb.boostActual ? cb.boostActual.max : b.meta.peakBoost;
  const boostUnit = ca.boostActual?.unit ?? a.meta.peakBoostUnit ?? cb.boostActual?.unit ?? "psi";

  // Worst (most negative) timing correction across all correction channels.
  const worstCorrection = (chs: LogSeries[]): number | null => {
    let worst: number | null = null;
    for (const s of chs) {
      const m = minOf(s.values);
      if (m === null) continue;
      if (worst === null || m < worst) worst = m;
    }
    return worst;
  };
  const corrA = worstCorrection(ca.timingCorrections);
  const corrB = worstCorrection(cb.timingCorrections);

  const iatA = ca.iat ? maxOf(ca.iat.values) : null;
  const iatB = cb.iat ? maxOf(cb.iat.values) : null;

  const metrics: MetricDelta[] = [
    {
      key: "peakBoost",
      label: "Peak Boost",
      unit: boostUnit,
      a: peakBoostA,
      b: peakBoostB,
      delta: delta(peakBoostA, peakBoostB),
      higherIsMore: true,
    },
    {
      key: "worstCorrection",
      label: "Max Zündwinkel-Korrektur",
      unit: ca.timingCorrections[0]?.unit ?? cb.timingCorrections[0]?.unit ?? "°",
      a: corrA,
      b: corrB,
      delta: delta(corrA, corrB),
      // A larger correction is a more-negative number; display-only flag.
      higherIsMore: false,
    },
    {
      key: "maxIat",
      label: "Max IAT",
      unit: ca.iat?.unit ?? cb.iat?.unit ?? "°C",
      a: iatA,
      b: iatB,
      delta: delta(iatA, iatB),
      higherIsMore: true,
    },
    {
      key: "maxRpm",
      label: "Max RPM",
      unit: null,
      a: a.meta.maxRpm,
      b: b.meta.maxRpm,
      delta: delta(a.meta.maxRpm, b.meta.maxRpm),
      higherIsMore: true,
    },
  ];

  return { metrics };
}

/** Channels that can be overlaid, keyed by the resolver role. */
export type OverlayChannel = "boostActual" | "boostTarget" | "iat" | "rpm";

export interface OverlayPoint {
  /** Shared X value (RPM by default). */
  x: number;
  /** Baseline (Log A) value at x, or null. */
  a: number | null;
  /** Comparison (Log B) value at x, or null. */
  b: number | null;
}

export interface OverlaySeries {
  points: OverlayPoint[];
  /** X-axis label/unit ("RPM" or the log time unit). */
  xLabel: string;
  /** Y unit of the overlaid channel, if known. */
  unit: string | null;
}

/** Build (rpm, value) pairs for one log's channel, sorted ascending by rpm. */
function rpmPairs(log: ParsedLog, role: OverlayChannel): { x: number; y: number }[] {
  const ch = resolveChannels(log);
  const rpm = ch.rpm;
  const target = role === "rpm" ? rpm : ch[role];
  if (!rpm || !target) return [];
  const pairs: { x: number; y: number }[] = [];
  for (let i = 0; i < log.time.length; i += 1) {
    const x = rpm.values[i];
    const y = target.values[i];
    if (x === null || y === null) continue;
    pairs.push({ x, y });
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

const DEFAULT_GRID = 160;

/**
 * Resample one channel of both logs onto a shared RPM grid so the overlay chart
 * can plot both on a single X axis with a synchronized cursor. The grid spans
 * the RPM range common to both logs (their overlap), so interpolation is always
 * in-range on at least one side and the traces line up.
 */
export function buildOverlay(
  a: ParsedLog,
  b: ParsedLog,
  role: OverlayChannel,
  gridSize: number = DEFAULT_GRID,
): OverlaySeries {
  const pairsA = rpmPairs(a, role);
  const pairsB = rpmPairs(b, role);
  const ca = resolveChannels(a);
  const cb = resolveChannels(b);
  const unit = role === "rpm" ? null : ca[role]?.unit ?? cb[role]?.unit ?? null;

  if (pairsA.length === 0 && pairsB.length === 0) {
    return { points: [], xLabel: "RPM", unit };
  }

  // Grid over the union of both RPM ranges so neither trace is truncated; points
  // outside a given log's own range interpolate to null on that side only.
  const lows = [pairsA[0]?.x, pairsB[0]?.x].filter((v): v is number => v !== undefined);
  const highs = [
    pairsA[pairsA.length - 1]?.x,
    pairsB[pairsB.length - 1]?.x,
  ].filter((v): v is number => v !== undefined);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { points: [], xLabel: "RPM", unit };
  }

  const steps = Math.max(2, gridSize);
  const points: OverlayPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const x = lo + ((hi - lo) * i) / (steps - 1);
    points.push({
      x: Math.round(x),
      a: interpolate(pairsA, x),
      b: interpolate(pairsB, x),
    });
  }
  return { points, xLabel: "RPM", unit };
}
