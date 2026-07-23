"use client";

import { Text } from "@mantine/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverlaySeries } from "./lib/compare-logs";
import classes from "./LogAnalyzer.module.css";

// A single overlay chart plotting both logs' selected channel on one shared X
// axis (RPM). Log A is a solid line, Log B a dashed line — the "colour + line
// style" differentiation from the spec — so the two are legible even where they
// cross. The synchronized cursor is inherent: one chart, one X axis.

export function OverlayChart({ overlay }: { overlay: OverlaySeries }) {
  if (overlay.points.length === 0) {
    return (
      <Text c="dimmed" ta="center" size="sm" py="lg">
        Für diesen Kanal liegen in beiden Logs keine gemeinsamen Daten vor.
      </Text>
    );
  }

  const unitSuffix = overlay.unit ? ` ${overlay.unit}` : "";

  return (
    <div className={classes.chartClip}>
      <div className={classes.chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={overlay.points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `${Math.round(Number(v))}`}
              tick={{ fontSize: 11 }}
              minTickGap={32}
              label={{ value: overlay.xLabel, position: "insideBottomRight", offset: -2, fontSize: 11 }}
            />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(v) => `${overlay.xLabel} = ${Math.round(Number(v))}`}
              formatter={(value, name) => {
                const num = typeof value === "number" ? value : Number(value);
                return [`${Number.isFinite(num) ? Math.round(num * 10) / 10 : "—"}${unitSuffix}`, name];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line
              type="monotone"
              dataKey="a"
              name="Log A"
              stroke="var(--mantine-color-orange-6)"
              dot={false}
              strokeWidth={1.8}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="b"
              name="Log B"
              stroke="var(--mantine-color-blue-6)"
              strokeDasharray="6 4"
              dot={false}
              strokeWidth={1.8}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
