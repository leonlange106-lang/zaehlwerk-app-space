"use client";

import { Skeleton } from "./components/ui/Skeleton";

// Recharts-free frame + placeholder for the admin metric plots.
//
// This module exists purely so it can be imported STATICALLY. `AdminPanel` needs
// the placeholder at first paint, and `AdminMetricsChart` needs the same card
// chrome — but that module pulls in Recharts, so importing the placeholder from
// there would drag the ~103 KB gzip chunk straight back into the eager graph and
// undo the split. Same reasoning as `apps/log-analyzer/ChartSkeletons.tsx`.
//
// Keep this file free of any Recharts import.

/** Plot height in px. Shared so placeholder and plot cannot drift apart — per
 *  the layout rule in CLAUDE.md, late-arriving content must not shift the page. */
export const PLOT_HEIGHT = 180;

export interface MetricPoint {
  t: number;
  label: string;
  cpu: number;
  mem: number;
}

/** Card chrome shared by the chart and its placeholder, so only the plot swaps. */
export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <p className="mb-1.5 px-1 text-[13px] font-semibold">{title}</p>
      <div style={{ width: "100%", height: PLOT_HEIGHT }}>{children}</div>
    </div>
  );
}

/** Placeholder with the identical box, shown while the chart chunk downloads. */
export function MetricChartSkeleton({ title }: { title: string }) {
  return (
    <ChartCard title={title}>
      <Skeleton className="h-full w-full" />
    </ChartCard>
  );
}
