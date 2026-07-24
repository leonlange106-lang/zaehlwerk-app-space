import { fmtNum, type ReportChartPanel, type ReportMarker } from "./report-generator";

// Pure chart geometry for the exported report. Given a `ReportChartPanel` and a
// pixel box, this computes everything a renderer needs: nice axis ticks, scaled
// polyline points, gap-aware segments, the pull band and the violation markers.
//
// It exists so the two renderers stay pixel-identical: the react-pdf document
// draws these coordinates with <Polyline>/<Line>, and the browser SVG builder
// writes the same numbers into an <svg> string that is rasterized to PNG. Neither
// renderer does any maths of its own.
//
// No DOM, no React, no measurement — all layout is computed from the numbers.

export interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const DEFAULT_PADDING: ChartPadding = { left: 44, right: 44, top: 10, bottom: 22 };

export interface AxisTick {
  value: number;
  /** Pixel position along the axis (x for the value axis, y for the others). */
  pos: number;
  label: string;
}

/** One continuous run of a trace; a null value starts a new segment. */
export type LineSegment = { x: number; y: number }[];

export interface GeometryLine {
  key: string;
  label: string;
  color: string;
  dashed: boolean;
  segments: LineSegment[];
}

export interface PanelGeometry {
  width: number;
  height: number;
  /** The plotting rectangle inside the padding. */
  plot: { x: number; y: number; width: number; height: number };
  xTicks: AxisTick[];
  leftTicks: AxisTick[];
  rightTicks: AxisTick[];
  lines: GeometryLine[];
  /** Pixel rect of the highlighted pull window, when it intersects the domain. */
  band: { x: number; width: number } | null;
  markers: { x: number; severity: ReportMarker["severity"]; label: string }[];
}

/**
 * Round a raw axis step up to the nearest "nice" number (1, 2, 5 × 10ⁿ) so the
 * gridlines land on values a human would have chosen.
 */
export function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Build up to `count` nice ticks spanning [min, max]. A degenerate domain (all
 * values identical, or a single sample) is widened so the trace still renders on
 * a sane scale instead of collapsing onto one line.
 */
export function niceTicks(min: number, max: number, count = 4): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / Math.max(1, count));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Accumulate by index rather than repeated addition so float error can't drift
  // the last tick past `hi` and drop it.
  const steps = Math.round((hi - lo) / step);
  for (let i = 0; i <= steps; i += 1) ticks.push(lo + i * step);
  return { ticks, lo, hi };
}

/** Decimals needed to tell neighbouring ticks apart (0–2). */
export function tickDigits(step: number): number {
  if (step >= 10) return 0;
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function axisLabel(value: number, step: number): string {
  // Above five digits an axis reads better abbreviated (7.000 → 7k).
  if (Math.abs(value) >= 10_000) return `${fmtNum(value / 1000, 0)}k`;
  return fmtNum(value, tickDigits(step));
}

/** Min/max across every value of the series assigned to one axis side. */
function domainFor(panel: ReportChartPanel, axis: "left" | "right"): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const series of panel.series) {
    if (series.axis !== axis) continue;
    for (const v of series.values) {
      if (v === null || !Number.isFinite(v)) continue;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
  }
  return min === null || max === null ? null : { min, max };
}

/**
 * Project a panel onto a pixel box. Returns null when there is nothing to draw
 * (no x samples, or no series with a finite value), so renderers can skip the
 * panel entirely rather than emitting an empty frame.
 */
export function buildPanelGeometry(
  panel: ReportChartPanel,
  width: number,
  height: number,
  padding: ChartPadding = DEFAULT_PADDING,
): PanelGeometry | null {
  if (panel.x.length === 0) return null;

  const left = domainFor(panel, "left");
  const right = domainFor(panel, "right");
  if (!left && !right) return null;

  const plot = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom),
  };

  const xDomain = niceTicks(panel.x[0], panel.x[panel.x.length - 1], 5);
  const xSpan = xDomain.hi - xDomain.lo || 1;
  const toX = (value: number): number => plot.x + ((value - xDomain.lo) / xSpan) * plot.width;

  const leftDomain = left ? niceTicks(left.min, left.max, 4) : null;
  const rightDomain = right ? niceTicks(right.min, right.max, 4) : null;
  const projector = (domain: typeof leftDomain) => {
    if (!domain) return null;
    const span = domain.hi - domain.lo || 1;
    // SVG y grows downward, so the domain maximum sits at the top of the plot.
    return (value: number): number => plot.y + plot.height - ((value - domain.lo) / span) * plot.height;
  };
  const toLeftY = projector(leftDomain);
  const toRightY = projector(rightDomain);

  const xStep = xDomain.ticks.length > 1 ? xDomain.ticks[1] - xDomain.ticks[0] : 1;
  const xTicks: AxisTick[] = xDomain.ticks.map((value) => ({
    value,
    pos: toX(value),
    label: axisLabel(value, xStep),
  }));

  const sideTicks = (domain: typeof leftDomain, project: ((v: number) => number) | null): AxisTick[] => {
    if (!domain || !project) return [];
    const step = domain.ticks.length > 1 ? domain.ticks[1] - domain.ticks[0] : 1;
    return domain.ticks.map((value) => ({ value, pos: project(value), label: axisLabel(value, step) }));
  };

  const lines: GeometryLine[] = [];
  for (const series of panel.series) {
    const project = series.axis === "right" ? toRightY : toLeftY;
    if (!project) continue;
    const segments: LineSegment[] = [];
    let current: LineSegment = [];
    for (let i = 0; i < panel.x.length; i += 1) {
      const v = series.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        // A gap ends the run — never draw a straight line across missing data.
        if (current.length > 0) segments.push(current);
        current = [];
        continue;
      }
      current.push({ x: toX(panel.x[i]), y: project(v) });
    }
    if (current.length > 0) segments.push(current);
    // A lone point has no line to draw but should still not vanish: keep it, the
    // renderers emit a 1-point polyline as a dot.
    if (segments.length > 0) {
      lines.push({
        key: series.key,
        label: series.label,
        color: series.color,
        dashed: series.dashed,
        segments,
      });
    }
  }

  let band: PanelGeometry["band"] = null;
  if (panel.band) {
    const from = Math.max(plot.x, toX(panel.band.start));
    const to = Math.min(plot.x + plot.width, toX(panel.band.end));
    if (to > from) band = { x: from, width: to - from };
  }

  const markers = panel.markers
    .map((m) => ({ x: toX(m.x), severity: m.severity, label: m.label }))
    .filter((m) => m.x >= plot.x - 0.5 && m.x <= plot.x + plot.width + 0.5);

  return {
    width,
    height,
    plot,
    xTicks,
    leftTicks: sideTicks(leftDomain, toLeftY),
    rightTicks: sideTicks(rightDomain, toRightY),
    lines,
    band,
    markers,
  };
}

/** Flatten a segment into the `"x,y x,y …"` form both SVG and react-pdf accept. */
export function pointsAttr(segment: LineSegment): string {
  return segment.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
