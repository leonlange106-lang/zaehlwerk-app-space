"use client";

import { Skeleton } from "@/app/components/ui/Skeleton";
import classes from "./LogAnalyzer.module.css";

// Placeholders shown while a lazily-loaded chart chunk is still downloading.
//
// Recharts is by far the largest thing the client bundle pulls in, so the chart
// components are split out and fetched on demand — but per the layout rule in
// CLAUDE.md anything that arrives after mount must occupy its final geometry
// from the first paint. These stand-ins therefore reuse the very same fixed
// height classes as the real charts (`chartBox` / `dynoBox`), which is what makes
// the swap invisible: the box is already the right size, only its contents
// change.
//
// They deliberately live in their own module. Importing them from the chart
// files would pull Recharts back into the main chunk and undo the split.

/** One chart panel: the header row plus the fixed-height plot area. */
function ChartPanelSkeleton({ boxClass }: { boxClass: string }) {
  return (
    <div className="panel p-3">
      <div className="mb-1.5 flex items-center justify-between px-1.5">
        <Skeleton height={14} width={120} />
        <Skeleton height={12} width={160} />
      </div>
      <div className={classes.chartClip}>
        <div className={boxClass}>
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Stand-in for the synchronized analyzer chart stack. `count` comes from
 * `groupSelectedSeries`, the same function the real stack groups with, so the
 * placeholder always reserves exactly as many panels as will appear.
 */
export function ChartStackSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <ChartPanelSkeleton key={i} boxClass={classes.chartBox} />
      ))}
    </div>
  );
}

/** Stand-in for the single comparison overlay plot. */
export function OverlayChartSkeleton() {
  return (
    <div className={classes.chartClip}>
      <div className={classes.chartBox}>
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

/** Stand-in for the (taller) dyno plot. */
export function DynoChartSkeleton() {
  return (
    <div className={classes.chartClip}>
      <div className={classes.dynoBox}>
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}
