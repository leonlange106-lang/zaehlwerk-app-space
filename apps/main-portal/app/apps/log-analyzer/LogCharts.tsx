"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildChartData, groupSelectedSeries } from "./lib/chart-data";
import type { AxisSide, LogSeries, ParsedLog } from "./lib/types";
import type { PullRange, Violation } from "./lib/evaluate-log-pull";
import classes from "./LogAnalyzer.module.css";

// A synchronized stack of line charts — one per parameter group that currently
// has selected channels. `syncId` wires a single crosshair cursor + tooltip
// across every chart, so hovering one point highlights the same instant on all
// of them. Each chart carries the analytical overlays: a soft green background
// for the detected verified-pull range and red dashed markers at every
// threshold violation, drawn on all panels so they line up on the shared X axis.

interface Props {
  log: ParsedLog;
  selectedKeys: string[];
  range: [number, number];
  axisById: Record<string, AxisSide>;
  colorById: Record<string, string>;
  pullRange: PullRange | null;
  pullVerified: boolean;
  violations: Violation[];
  exclusionRanges: PullRange[];
}

// Overlay colours come from the global status tokens rather than literals, so
// the analytical layer keeps the same meaning as every badge in the product and
// automatically re-resolves for the light scheme. SVG resolves `var()` in
// stroke/fill just as CSS does.
const OK = "var(--zw-ok)";
const CRITICAL = "var(--zw-risk)";
const WARNING = "var(--zw-watch)";
const SHIFT_GREY = "var(--zw-neutral)";
/** Axis/grid furniture — deliberately quiet so the traces stay the loudest thing. */
const GRID = "var(--zw-border)";
const AXIS_TEXT = "var(--zw-text-dim)";

function formatX(value: number, unit: "s" | "#"): string {
  if (unit === "#") return String(Math.round(value));
  return `${value.toFixed(value < 10 ? 2 : 1)}s`;
}

export function LogCharts({
  log,
  selectedKeys,
  range,
  axisById,
  colorById,
  pullRange,
  pullVerified,
  violations,
  exclusionRanges,
}: Props) {
  // Points (decimated) for the visible window, shared by every chart so the
  // syncId cursor lines up 1:1 across the stack.
  const data = useMemo(
    () => buildChartData(log, selectedKeys, range[0], range[1]),
    [log, selectedKeys, range],
  );

  // Group the *selected* series so each group gets its own chart. Shared with
  // the loading placeholder so both agree on the panel count.
  const groups = useMemo(
    () => groupSelectedSeries(log.series, selectedKeys),
    [log.series, selectedKeys],
  );

  if (groups.length === 0) {
    return (
      <div className="panel p-8">
        <p className="text-center text-sm text-dim">
          Keine Parameter ausgewählt. Aktiviere links Messwerte, um Graphen anzuzeigen.
        </p>
      </div>
    );
  }

  const colorFor = (s: LogSeries) => colorById[s.key] ?? s.color;
  const sideFor = (s: LogSeries): AxisSide => axisById[s.key] ?? "left";
  const areaColor = pullVerified ? OK : WARNING;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([groupName, series], groupIndex) => {
        const usesRight = series.some((s) => sideFor(s) === "right");
        // Labels for overlays are only drawn once (top chart) to avoid clutter.
        const showOverlayLabels = groupIndex === 0;
        return (
          <div className="panel p-3" key={groupName}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1.5">
              <p className="text-sm font-semibold">
                {groupName}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {series.map((s) => (
                  <span className="flex flex-none items-center gap-1.5" key={s.key}>
                    <span className={classes.legendDot} style={{ backgroundColor: colorFor(s) }} />
                    <span className="text-xs text-dim">
                      {s.label}
                      {s.unit ? ` (${s.unit})` : ""}
                      {sideFor(s) === "right" ? " ›" : ""}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className={classes.chartClip}>
              <div className={classes.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    syncId="log-analyzer"
                    margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => formatX(Number(v), log.timeUnit)}
                      tick={{ fontSize: 10, fill: AXIS_TEXT }}
                      stroke={GRID}
                      minTickGap={32}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: AXIS_TEXT }}
                      stroke={GRID}
                      width={40}
                    />
                    {usesRight && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: AXIS_TEXT }}
                        stroke={GRID}
                        width={40}
                      />
                    )}

                    {/* Gear-shift zones — grey, not safety-evaluated (transient spikes). */}
                    {exclusionRanges.map((z, i) => (
                      <ReferenceArea
                        key={`shift-${i}`}
                        yAxisId="left"
                        x1={z.start}
                        x2={z.end}
                        fill={SHIFT_GREY}
                        fillOpacity={0.18}
                        ifOverflow="hidden"
                      >
                        {showOverlayLabels && i === 0 && (
                          <Label value="Schaltzone" position="insideTop" fontSize={10} fill={SHIFT_GREY} />
                        )}
                      </ReferenceArea>
                    ))}

                    {/* Verified / detected pull range — soft green (or amber) zone. */}
                    {pullRange && (
                      <ReferenceArea
                        yAxisId="left"
                        x1={pullRange.start}
                        x2={pullRange.end}
                        fill={areaColor}
                        fillOpacity={0.12}
                        stroke={areaColor}
                        strokeOpacity={0.35}
                        ifOverflow="hidden"
                      >
                        {showOverlayLabels && (
                          <Label
                            value={pullVerified ? "Verified Pull Range" : "Erkannter Pull"}
                            position="insideTopLeft"
                            fontSize={11}
                            fill={areaColor}
                          />
                        )}
                      </ReferenceArea>
                    )}

                    {/* Threshold violations — red (critical) / amber (warning) markers. */}
                    {violations.map((v, i) => {
                      const stroke = v.severity === "critical" ? CRITICAL : WARNING;
                      return (
                        <ReferenceLine
                          key={`${v.id}-${i}`}
                          yAxisId="left"
                          x={v.time}
                          stroke={stroke}
                          strokeDasharray="3 3"
                          strokeWidth={1.4}
                          ifOverflow="hidden"
                        >
                          {showOverlayLabels && (
                            <Label
                              value={v.label}
                              position="top"
                              angle={-90}
                              fontSize={10}
                              fill={stroke}
                              offset={8}
                            />
                          )}
                        </ReferenceLine>
                      );
                    })}

                    <Tooltip
                      isAnimationActive={false}
                      labelFormatter={(v) => `t = ${formatX(Number(v), log.timeUnit)}`}
                      formatter={(value, _name, item) => {
                        const s = series.find((x) => x.key === item.dataKey);
                        const num = typeof value === "number" ? value : Number(value);
                        return [
                          `${Number.isFinite(num) ? num : "—"}${s?.unit ? ` ${s.unit}` : ""}`,
                          s?.label ?? String(item.dataKey),
                        ];
                      }}
                      // The tooltip is a raised plate like every other floating
                      // surface: elevated fill, hairline outline, hard corners.
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 4,
                        background: "var(--zw-elevated)",
                        border: "1px solid var(--zw-border)",
                        color: "var(--zw-text)",
                      }}
                      labelStyle={{ color: "var(--zw-text-dim)" }}
                      cursor={{ stroke: "var(--zw-border-strong)", strokeWidth: 1 }}
                    />
                    {series.map((s) => (
                      <Line
                        key={s.key}
                        yAxisId={sideFor(s)}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={colorFor(s)}
                        dot={false}
                        // Slightly heavier than before: on the near-black canvas
                        // a 1.6px stroke reads thin, especially for the cooler
                        // channel colours.
                        strokeWidth={1.8}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
