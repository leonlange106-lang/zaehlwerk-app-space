"use client";

import { useMemo } from "react";
import { Card, Group, Stack, Text } from "@mantine/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildChartData } from "./lib/chart-data";
import type { LogSeries, ParsedLog } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// A synchronized stack of line charts — one per parameter group that currently
// has selected channels. `syncId` wires a single crosshair cursor + tooltip
// across every chart, so hovering one point highlights the same instant on all
// of them (the "synchronized cursor" requirement). Zoom is driven from the
// parent via the `range` sample-index window.

interface Props {
  log: ParsedLog;
  selectedKeys: string[];
  range: [number, number];
}

function formatX(value: number, unit: "s" | "#"): string {
  if (unit === "#") return String(Math.round(value));
  return `${value.toFixed(value < 10 ? 2 : 1)}s`;
}

export function LogCharts({ log, selectedKeys, range }: Props) {
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

  return (
    <Stack gap="md">
      {groups.map(([groupName, series]) => (
        <Card withBorder radius="md" p="sm" key={groupName}>
          <Group justify="space-between" mb={6} px={6}>
            <Text fw={600} size="sm">
              {groupName}
            </Text>
            <Group gap="sm">
              {series.map((s) => (
                <Group gap={5} key={s.key} wrap="nowrap">
                  <span className={classes.legendDot} style={{ backgroundColor: s.color }} />
                  <Text size="xs" c="dimmed">
                    {s.label}
                    {s.unit ? ` (${s.unit})` : ""}
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
                  <YAxis tick={{ fontSize: 11 }} width={44} />
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
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
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
      ))}
    </Stack>
  );
}
