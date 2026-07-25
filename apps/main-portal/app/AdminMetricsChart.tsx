"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, type MetricPoint } from "./AdminChartFrame";

// Split out of AdminPanel so Recharts stays in an async chunk.
//
// AdminPanel is a client component rendered from the launcher (`app/page.tsx`),
// and it used to import Recharts statically. That put the ~103 KB gzip Recharts
// chunk into the client graph of the landing page — and it was measurably being
// executed on `/login`, `/setup` and `/changelog` too, pages without a single
// chart. Every other chart in this app was already behind `React.lazy`; this was
// the one exception.
//
// The card chrome, the plot height and the placeholder live in `AdminChartFrame`
// precisely because that module must stay importable without Recharts.

export function MetricChart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: MetricPoint[];
  dataKey: "cpu" | "mem";
  color: string;
}) {
  const gradientId = `grad-${dataKey}`;
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={34} unit="%" />
          <Tooltip
            isAnimationActive={false}
            labelFormatter={(v) => `t = ${v}`}
            formatter={(value) => [`${value}%`, title]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
