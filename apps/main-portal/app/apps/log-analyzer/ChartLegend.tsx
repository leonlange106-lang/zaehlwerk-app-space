"use client";

// The legend shared by the comparison overlay and the dyno plot, plus the two
// charts' palette. Both plots use the same visual grammar — a solid primary
// trace, a dashed secondary one and a thin dotted reference — so the swatch and
// the line it stands for are defined together and cannot drift apart.

export const SERIES_COLORS = {
  /** Log A · power — the leading trace, in the app's own high-octane orange. */
  primary: "var(--zw-series-primary)",
  /**
   * Log B · torque — the second trace, drawn dashed. The furthest hue from the
   * primary that still holds up at 1.8px on the dark deck, and the pair stays
   * distinguishable under both common red-green deficiencies (the dash pattern
   * carries the distinction regardless of hue).
   */
  secondary: "var(--zw-series-secondary)",
  /** Companion/cross-check trace: muted, and correct in both colour schemes. */
  reference: "var(--zw-text-dim)",
} as const;

/**
 * Tooltip configuration for the plots that still float one.
 *
 * PINNED TO THE TOP of the plot area: on a touch screen the finger sits exactly
 * on the point being read, so a box anchored there covers the very curve you are
 * scrubbing along. Only `y` is fixed; `x` still follows the cursor.
 *
 * The stacked analyzer charts do not use this — they read out BELOW the plot
 * instead (see ChartReadout), which is strictly better and only practical there
 * because those charts share one x axis and one data array.
 */
export const CHART_TOOLTIP_PROPS = {
  isAnimationActive: false,
  position: { y: 0 },
  wrapperStyle: { maxWidth: 240, zIndex: 1 },
  contentStyle: {
    fontSize: 11,
    lineHeight: 1.35,
    padding: "6px 8px",
    borderRadius: 4,
    background: "var(--zw-elevated)",
    border: "1px solid var(--zw-border)",
    color: "var(--zw-text)",
  },
  labelStyle: { color: "var(--zw-text-dim)", marginBottom: 2 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--zw-border-strong)", strokeWidth: 1 },
} as const;

/** Cursor line without a box — for charts that read out below the plot. */
export const CHART_CURSOR_ONLY_PROPS = {
  isAnimationActive: false,
  // Renders nothing. The values live in the readout strip under the chart, so a
  // floating box would only repeat them on top of the data.
  content: () => null,
  cursor: { stroke: "var(--zw-border-strong)", strokeWidth: 1 },
} as const;

export interface ReadoutItem {
  label: string;
  value: string;
  color: string;
}

/**
 * The value strip under a plot.
 *
 * ALWAYS RENDERED, never conditional: it sits between the chart and whatever
 * follows, so appearing on first touch would shove the page under the reader's
 * finger — the CLS rule this product holds itself to. With nothing selected it
 * shows the same channels with an em dash, which also tells you what you are
 * about to get.
 *
 * One line, scrolled horizontally rather than wrapped, so a group with five
 * channels cannot change the chart card's height mid-drag.
 */
export function ChartReadout({
  x,
  items,
  active,
  className,
}: {
  /** Formatted x position, e.g. "t = 5.55s". */
  x: string;
  items: ReadoutItem[];
  active: boolean;
  className?: string;
}) {
  return (
    <div
      className={`mt-1.5 flex h-7 items-center gap-3 overflow-x-auto whitespace-nowrap px-1.5 text-[11px] ${className ?? ""}`}
      // A live region would announce on every pixel of a drag. The values are
      // readable as text; the announcement would be noise.
      aria-hidden={!active}
    >
      <span className="readout flex-none text-dim">{x}</span>
      {items.map((item) => (
        <span key={item.label} className="flex flex-none items-center gap-1.5">
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-dim">{item.label}</span>
          <span className="readout">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

export function LegendItem({
  color,
  style,
  label,
}: {
  color: string;
  style: "solid" | "dashed" | "dotted";
  label: string;
}) {
  return (
    <span className="flex flex-none items-center gap-1.5">
      <span aria-hidden style={{ width: 22, height: 0, borderTop: `2px ${style} ${color}` }} />
      <span className="text-xs text-dim">{label}</span>
    </span>
  );
}
