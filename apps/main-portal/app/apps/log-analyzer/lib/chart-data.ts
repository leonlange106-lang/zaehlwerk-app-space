import type { ParsedLog } from "./types";

// Turning a parsed log into Recharts-ready points, with decimation so even a
// large log stays smooth. Charting every sample of a multi-minute log would
// render tens of thousands of SVG points per line and stutter on mobile; we cap
// the visible window to a target point count via uniform striding (cheap, and
// visually faithful for line traces).

export interface ChartPoint {
  /** X value (seconds or sample index) for this point. */
  x: number;
  /** One entry per selected series key → its value (or null for a gap). */
  [seriesKey: string]: number | null;
}

const DEFAULT_TARGET = 1200;

/**
 * Build the point array for the currently selected series within `[start, end]`
 * (inclusive sample indices), decimated to at most `target` points.
 */
export function buildChartData(
  log: ParsedLog,
  selectedKeys: string[],
  start: number,
  end: number,
  target: number = DEFAULT_TARGET,
): ChartPoint[] {
  const lo = Math.max(0, Math.min(start, log.time.length - 1));
  const hi = Math.max(lo, Math.min(end, log.time.length - 1));
  const span = hi - lo + 1;
  if (span <= 0) return [];

  const stride = span > target ? Math.ceil(span / target) : 1;
  const byKey = new Map(log.series.map((s) => [s.key, s]));
  const selected = selectedKeys.map((k) => byKey.get(k)).filter((s): s is NonNullable<typeof s> => !!s);

  const points: ChartPoint[] = [];
  for (let i = lo; i <= hi; i += stride) {
    const point: ChartPoint = { x: log.time[i] };
    for (const s of selected) point[s.key] = s.values[i];
    points.push(point);
  }
  // Always include the last sample so the trace reaches the window's end.
  if ((hi - lo) % stride !== 0) {
    const point: ChartPoint = { x: log.time[hi] };
    for (const s of selected) point[s.key] = s.values[hi];
    points.push(point);
  }
  return points;
}
