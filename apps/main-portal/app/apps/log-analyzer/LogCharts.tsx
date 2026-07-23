"use client";

import { useMemo } from "react";
import { Card, Group, Stack, Text } from "@mantine/core";
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
import { buildChartData } from "./lib/chart-data";
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

const GREEN = "#22c55e";
const CRITICAL = "#e03131";
const WARNING = "#f08c00";
const SHIFT_GREY = "#868e96";

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
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // Points (decimated) for the visible window, shared by every chart so the
  // syncId cursor lines up 1:1 across the stack.
  const data = useMemo(
    () => buildChartData(log, selectedKeys, range[0], range[1]),
    [log, selectedKeys, range],
  );

  // Group the *selected* series so each group gets its own chart.
  const groups = useMemo(() => {
    const map = new Map<string, LogSeries[]>();
    for (const s of log.series) {
      if (!selectedSet.has(s.key)) continue;
      const list = map.get(s.group) ?? [];
      list.push(s);
      map.set(s.group, list);
    }
    return [...map.entries()];
  }, [log.series, selectedSet]);

  if (groups.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Text c="dimmed" ta="center" size="sm">
          Keine Parameter ausgewählt. Aktiviere links Messwerte, um Graphen anzuzeigen.
        </Text>
      </Card>
    );
  }

  const colorFor = (s: LogSeries) => colorById[s.key] ?? s.color;
  const sideFor = (s: LogSeries): AxisSide => axisById[s.key] ?? "left";
  const areaColor = pullVerified ? GREEN : WARNING;

  return (
    <Stack gap="md">
      {groups.map(([groupName, series], groupIndex) => {
        const usesRight = series.some((s) => sideFor(s) === "right");
        // Labels for overlays are only drawn once (top chart) to avoid clutter.
        const showOverlayLabels = groupIndex === 0;
        return (
          <Card withBorder radius="md" p="sm" key={groupName}>
            <Group justify="space-between" mb={6} px={6}>
              <Text fw={600} size="sm">
                {groupName}
              </Text>
              <Group gap="sm">
                {series.map((s) => (
                  <Group gap={5} key={s.key} wrap="nowrap">
                    <span className={classes.legendDot} style={{ backgroundColor: colorFor(s) }} />
                    <Text size="xs" c="dimmed">
                      {s.label}
                      {s.unit ? ` (${s.unit})` : ""}
                      {sideFor(s) === "right" ? " ›" : ""}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Group>
            <div className={classes.chartClip}>
              <div className={classes.chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    syncId="log-analyzer"
                    margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => formatX(Number(v), log.timeUnit)}
                      tick={{ fontSize: 11 }}
                      minTickGap={32}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={44} />
                    {usesRight && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        width={44}
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
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
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
                        strokeWidth={1.6}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>
        );
      })}
    </Stack>
  );
}
