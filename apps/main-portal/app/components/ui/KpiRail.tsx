import type { CSSProperties } from "react";
import { MetricTile, type MetricTileProps } from "./MetricTile";
import classes from "./KpiRail.module.css";

// Horizontally scrollable, sticky micro-KPI rail — the top-of-page metric strip
// for both apps. Takes plain data rather than children so every rail in the
// product renders identical geometry (and therefore reserves identical space).

export interface KpiRailProps {
  items: (MetricTileProps & { key: string })[];
  /**
   * Columns to use from `sm` up, where the rail becomes a grid. Defaults to 4.
   * Below `sm` it is always a single scrolling row, regardless of this.
   */
  columns?: number;
  /** Pin the rail under the header while scrolling (phones only). Default: true. */
  sticky?: boolean;
  /** Accessible name — several pages carry more than one rail. */
  label?: string;
}

export function KpiRail({ items, columns = 4, sticky = true, label = "Kennzahlen" }: KpiRailProps) {
  return (
    <div className={sticky ? classes.sticky : undefined}>
      <div
        className={classes.rail}
        style={{ "--rail-cols": columns } as CSSProperties}
        role="group"
        aria-label={label}
      >
        {items.map(({ key, ...tile }) => (
          <div key={key} className={classes.item}>
            <MetricTile {...tile} />
          </div>
        ))}
      </div>
    </div>
  );
}
