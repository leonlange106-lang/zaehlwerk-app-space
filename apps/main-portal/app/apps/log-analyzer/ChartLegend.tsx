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
