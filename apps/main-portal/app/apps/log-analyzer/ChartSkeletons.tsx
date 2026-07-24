"use client";

import { Card, Group, Skeleton, Stack } from "@mantine/core";
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
    <Card withBorder radius="md" p="sm">
      <Group justify="space-between" mb={6} px={6}>
        <Skeleton height={14} width={120} radius="sm" />
        <Skeleton height={12} width={160} radius="sm" />
      </Group>
      <div className={classes.chartClip}>
        <div className={boxClass}>
          <Skeleton height="100%" radius="sm" />
        </div>
      </div>
    </Card>
  );
}

/**
 * Stand-in for the synchronized analyzer chart stack. `count` comes from
 * `groupSelectedSeries`, the same function the real stack groups with, so the
 * placeholder always reserves exactly as many panels as will appear.
 */
export function ChartStackSkeleton({ count }: { count: number }) {
  return (
    <Stack gap="md">
      {Array.from({ length: Math.max(1, count) }, (_, i) => (
        <ChartPanelSkeleton key={i} boxClass={classes.chartBox} />
      ))}
    </Stack>
  );
}

/** Stand-in for the single comparison overlay plot. */
export function OverlayChartSkeleton() {
  return (
    <div className={classes.chartClip}>
      <div className={classes.chartBox}>
        <Skeleton height="100%" radius="sm" />
      </div>
    </div>
  );
}

/** Stand-in for the (taller) dyno plot. */
export function DynoChartSkeleton() {
  return (
    <div className={classes.chartClip}>
      <div className={classes.dynoBox}>
        <Skeleton height="100%" radius="sm" />
      </div>
    </div>
  );
}
