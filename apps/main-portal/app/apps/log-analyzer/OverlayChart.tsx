"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverlaySeries } from "./lib/compare-logs";
import { CHART_TOOLTIP_PROPS, SERIES_COLORS } from "./ChartLegend";
import classes from "./LogAnalyzer.module.css";

// The overlay chart: both logs' selected channel on one shared X axis (elapsed
// time from the WOT start, or RPM). Log A is drawn solid, Log B dashed — the
// "line style + colour" differentiation — so the two stay legible where they
// cross. Channels with a companion trace (Boost Target) add a third and fourth
// thin dotted line in the same per-log colour.
//
// The tooltip is synchronized by construction: one chart, one X axis, so a
// single hover reports every trace's value at that same sample point.

const COLOR_A = SERIES_COLORS.primary;
const COLOR_B = SERIES_COLORS.secondary;

export function OverlayChart({
  overlay,
  nameA,
  nameB,
}: {
  overlay: OverlaySeries;
  nameA: string;
  nameB: string;
}) {
  if (overlay.points.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-dim">
        Für diesen Kanal liegen in beiden Logs keine gemeinsamen Daten vor.
      </p>
    );
  }

  const unitSuffix = overlay.unit ? ` ${overlay.unit}` : "";
  const isTime = overlay.axis === "time";
  const fmtX = (v: number): string =>
    isTime ? `${(Math.round(v * 100) / 100).toLocaleString("de-DE")}` : `${Math.round(v)}`;
  const ref = overlay.refLabel ?? "Target";
  // A t = 0 marker only means something on the aligned time axis.
  const showZero =
    isTime && overlay.points[0].x < 0 && overlay.points[overlay.points.length - 1].x > 0;

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
              tickFormatter={(v) => fmtX(Number(v))}
              tick={{ fontSize: 11 }}
              minTickGap={32}
              label={{ value: overlay.xLabel, position: "insideBottomRight", offset: -2, fontSize: 11 }}
            />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            {showZero && (
              <ReferenceLine
                x={0}
                stroke={SERIES_COLORS.reference}
                strokeDasharray="4 4"
                label={{ value: "WOT", fontSize: 10, position: "top" }}
              />
            )}
            <Tooltip
              {...CHART_TOOLTIP_PROPS}
              labelFormatter={(v) => `${overlay.xLabel} = ${fmtX(Number(v))}`}
              formatter={(value, name) => {
                const num = typeof value === "number" ? value : Number(value);
                return [`${Number.isFinite(num) ? Math.round(num * 100) / 100 : "—"}${unitSuffix}`, name];
              }}
            />
            <Line
              type="monotone"
              dataKey="a"
              name={`${nameA} (A)`}
              stroke={COLOR_A}
              dot={false}
              strokeWidth={1.8}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="b"
              name={`${nameB} (B)`}
              stroke={COLOR_B}
              strokeDasharray="6 4"
              dot={false}
              strokeWidth={1.8}
              isAnimationActive={false}
              connectNulls
            />
            {overlay.hasRef && (
              <Line
                type="monotone"
                dataKey="aRef"
                name={`${nameA} · ${ref}`}
                stroke={COLOR_A}
                strokeDasharray="2 3"
                dot={false}
                strokeWidth={1.2}
                opacity={0.75}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {overlay.hasRef && (
              <Line
                type="monotone"
                dataKey="bRef"
                name={`${nameB} · ${ref}`}
                stroke={COLOR_B}
                strokeDasharray="2 3"
                dot={false}
                strokeWidth={1.2}
                opacity={0.75}
                isAnimationActive={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
