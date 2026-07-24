"use client";

import { Text } from "@mantine/core";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DynoChartRow, DynoCurve, DynoOutput } from "./lib/dyno-engine";
import classes from "./LogAnalyzer.module.css";

// The dyno plot: engine speed on X, power (PS) on the left axis and torque (Nm)
// on the right — the layout every dyno sheet uses, so the two curves crossing
// near 5252 rpm reads exactly as a tuner expects. The cross-check method's power
// is drawn as a thin dotted line: where the two methods agree, the estimate is
// trustworthy; where they diverge, the vehicle profile (or the road) is off.

const POWER_COLOR = "var(--mantine-color-orange-6)";
const TORQUE_COLOR = "var(--mantine-color-blue-6)";
const REF_COLOR = "var(--mantine-color-gray-5)";

export function DynoChart({
  rows,
  curve,
  output,
  crossCheckLabel,
}: {
  rows: DynoChartRow[];
  curve: DynoCurve;
  output: DynoOutput;
  crossCheckLabel: string | null;
}) {
  if (rows.length === 0) {
    return (
      <Text c="dimmed" ta="center" size="sm" py="lg">
        Keine Kurvendaten für dieses Log.
      </Text>
    );
  }

  const peakRpm = curve.peakPower?.rpm ?? null;
  const suffix = output === "wheel" ? " (Rad)" : "";

  return (
    <div className={classes.chartClip}>
      <div className={classes.dynoBox}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis
              dataKey="rpm"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `${Math.round(Number(v))}`}
              tick={{ fontSize: 11 }}
              minTickGap={32}
              label={{ value: "Drehzahl (1/min)", position: "insideBottomRight", offset: -2, fontSize: 11 }}
            />
            <YAxis
              yAxisId="power"
              tick={{ fontSize: 11 }}
              width={48}
              domain={[0, "auto"]}
              label={{ value: "PS", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <YAxis
              yAxisId="torque"
              orientation="right"
              tick={{ fontSize: 11 }}
              width={48}
              domain={[0, "auto"]}
              label={{ value: "Nm", angle: 90, position: "insideRight", fontSize: 11 }}
            />

            {peakRpm !== null && (
              <ReferenceLine
                yAxisId="power"
                x={peakRpm}
                stroke={POWER_COLOR}
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              >
                <Label value="Pmax" position="top" fontSize={10} fill={POWER_COLOR} />
              </ReferenceLine>
            )}

            <Tooltip
              isAnimationActive={false}
              labelFormatter={(v) => `${Math.round(Number(v))} 1/min`}
              formatter={(value, name) => {
                const num = typeof value === "number" ? value : Number(value);
                const unit = String(name).startsWith("Drehmoment") ? "Nm" : "PS";
                return [`${Number.isFinite(num) ? num.toLocaleString("de-DE") : "—"} ${unit}`, name];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />

            <Line
              yAxisId="power"
              type="monotone"
              dataKey="power"
              name={`Leistung${suffix}`}
              stroke={POWER_COLOR}
              dot={false}
              strokeWidth={2.2}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="torque"
              type="monotone"
              dataKey="torque"
              name={`Drehmoment${suffix}`}
              stroke={TORQUE_COLOR}
              strokeDasharray="6 4"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
            />
            {crossCheckLabel && (
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="refPower"
                name={`Leistung · ${crossCheckLabel}`}
                stroke={REF_COLOR}
                strokeDasharray="2 3"
                dot={false}
                strokeWidth={1.4}
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
