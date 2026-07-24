"use client";

import { Group, Text } from "@mantine/core";

// The legend shared by the comparison overlay and the dyno plot, plus the two
// charts' palette. Both plots use the same visual grammar — a solid primary
// trace, a dashed secondary one and a thin dotted reference — so the swatch and
// the line it stands for are defined together and cannot drift apart.

export const SERIES_COLORS = {
  /** Log A · power — the leading trace, in the app's own high-octane orange. */
  primary: "var(--mantine-color-orange-6)",
  /**
   * Log B · torque — the second trace, drawn dashed. Electric cyan is the
   * furthest hue from the primary that still holds up at 1.8px on the near-black
   * canvas, and the pair stays distinguishable under both common red-green
   * deficiencies (the dash pattern carries the distinction regardless).
   */
  secondary: "var(--mantine-color-cyan-4)",
  /** Companion/cross-check trace: muted and theme-aware in light and dark. */
  reference: "var(--mantine-color-dimmed)",
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
    <Group gap={6} wrap="nowrap">
      <span style={{ width: 22, height: 0, borderTop: `2px ${style} ${color}` }} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
