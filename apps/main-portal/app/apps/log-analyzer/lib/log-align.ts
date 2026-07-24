import { resolveChannels, type ResolvedChannels } from "./channels";
import { detectPull } from "./evaluate-log-pull";
import type { ParsedLog } from "./types";

// Alignment for the dual-log overlay. Two logs of "the same" pull are never
// recorded from the same instant: the driver floors it at t = 4.2 s in one and
// t = 11.8 s in the other, so plotting both on their raw time axes puts the two
// spool-ups nowhere near each other and the comparison is meaningless.
//
// This module answers the two questions the overlay needs:
//   1. WHERE does the pull start? (t = 0 anchor — the first ≥ 99 % pedal sample
//      of the detected WOT pull, reusing the evaluation engine's detector so the
//      overlay and the verdict agree on what "the pull" is.)
//   2. WHAT is the X value of sample i? (elapsed time since that anchor, or
//      engine speed — the RPM axis makes two pulls directly comparable even when
//      one car accelerates faster.)
//
// Pure and dependency-free: no DOM, no framework, unit-testable in isolation.

/** How the X axis of an overlay is anchored. */
export type AlignMode =
  /** Raw log time — no shift; useful to inspect the logs as recorded. */
  | "raw"
  /** t = 0 at the first WOT sample of the detected pull. */
  | "wot";

/** Which quantity forms the shared X axis of an overlay. */
export type OverlayAxis = "time" | "rpm";

export interface LogAlignment {
  /** Sample index of the pull start (the t = 0 anchor). */
  startIndex: number;
  /** Sample index of the pull end. */
  endIndex: number;
  /** X-axis value at `startIndex`; subtracted from every sample in "wot" mode. */
  offset: number;
  /**
   * True when the anchor is a genuine pedal-driven WOT start. False means the
   * log had no usable pedal channel and the anchor fell back to the RPM sweep,
   * so the alignment is a best effort rather than an exact ≥ 99 % pedal match.
   */
  pedalDriven: boolean;
  /** RPM at the anchor sample, when an RPM channel exists. */
  startRpm: number | null;
}

/**
 * Locate a log's WOT-pull start and derive the t = 0 offset from it. Total: a
 * log with no channels at all yields a zero-offset alignment rather than
 * throwing, so the overlay degrades to "raw" instead of breaking.
 */
export function alignLog(log: ParsedLog, ch: ResolvedChannels = resolveChannels(log)): LogAlignment {
  const pull = detectPull(log, ch);
  const [startIndex, endIndex] = pull.window;
  const offset = log.time[startIndex] ?? 0;
  const startRpm = ch.rpm ? ch.rpm.values[startIndex] ?? null : null;
  return { startIndex, endIndex, offset, pedalDriven: pull.pedalDriven, startRpm };
}

/**
 * Build the X-axis accessor for one log: sample index → shared X value, or null
 * when that sample cannot be placed on the axis (a gap in the RPM channel).
 *
 * On the time axis in "wot" mode the anchor sample lands exactly on 0 and
 * pre-pull samples go negative — deliberately kept rather than clipped, so the
 * approach into boost stays visible on both traces.
 */
export function axisValueAt(
  log: ParsedLog,
  ch: ResolvedChannels,
  alignment: LogAlignment,
  axis: OverlayAxis,
  mode: AlignMode,
): (i: number) => number | null {
  if (axis === "rpm") {
    const rpm = ch.rpm;
    if (!rpm) return () => null;
    return (i) => rpm.values[i] ?? null;
  }
  const shift = mode === "wot" ? alignment.offset : 0;
  return (i) => {
    const t = log.time[i];
    return t === undefined ? null : t - shift;
  };
}

/** Axis label for the overlay chart's X axis. */
export function axisLabel(log: ParsedLog, axis: OverlayAxis, mode: AlignMode): string {
  if (axis === "rpm") return "RPM";
  const unit = log.timeUnit === "s" ? "s" : "#";
  return mode === "wot" ? `t − WOT (${unit})` : `Zeit (${unit})`;
}

/**
 * Elapsed time from the pull anchor to sample `i`, or null on a synthetic
 * (index-based) time axis where a "duration" would be meaningless. Used by the
 * spool-up delta metric, which must report seconds — not sample counts.
 */
export function elapsedSeconds(log: ParsedLog, alignment: LogAlignment, i: number): number | null {
  if (log.timeUnit !== "s") return null;
  const t = log.time[i];
  if (t === undefined) return null;
  return t - alignment.offset;
}
