import type { CSSProperties, ReactNode } from "react";
import { Skeleton } from "@mantine/core";
import classes from "./MetricTile.module.css";

// The single KPI plate used across both apps. Server-component safe (no hooks,
// no event handlers), so dashboards can render it straight from their data
// fetch without a client boundary.

export interface MetricTileProps {
  /** Short, uppercase-rendered caption — "Aktive Zähler", "Peak Boost", … */
  label: string;
  /** The number/quantity itself. Already formatted (de-DE) by the caller. */
  value: ReactNode;
  /** One line of context under the value: unit, delta, freshness. */
  hint?: ReactNode;
  /** Tabler icon element, rendered at 15px in the header row. */
  icon?: ReactNode;
  /**
   * CSS colour for the spine + icon. Defaults to the ambient app accent, so a
   * tile inside the Log Analyzer is orange and one inside Zählwerk is cyan
   * without either page passing anything.
   */
  accent?: string;
}

export function MetricTile({ label, value, hint, icon, accent }: MetricTileProps) {
  return (
    <div
      className={classes.tile}
      style={{ "--tile-accent": accent ?? "var(--zw-accent)" } as CSSProperties}
    >
      <div className={classes.head}>
        <span className={classes.label}>{label}</span>
        {icon && <span className={classes.icon}>{icon}</span>}
      </div>
      <div className={classes.value}>{value}</div>
      {hint !== undefined && <div className={classes.hint}>{hint}</div>}
    </div>
  );
}

/**
 * Stand-in with the tile's exact geometry, for KPIs that resolve after mount.
 * Same box in, same box out — swapping it for the real tile shifts nothing.
 */
export function MetricTileSkeleton() {
  return (
    <div className={classes.tile}>
      <div className={classes.head}>
        <Skeleton height={9} width={72} radius="xs" />
      </div>
      <Skeleton height={20} width={56} radius="xs" />
      <Skeleton height={9} width={90} radius="xs" />
    </div>
  );
}
