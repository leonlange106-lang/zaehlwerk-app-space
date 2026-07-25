import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/lib/cn";
import { Skeleton } from "./Skeleton";
import type { StatusTone } from "./StatusBadge";

// The single KPI plate used across both apps. Server-component safe (no hooks,
// no event handlers), so dashboards can render it straight from their data fetch
// without a client boundary.
//
// Each tile is washed in its own hue: a soft radial glow from the top-right plus
// a matching icon chip. That is what makes a row of tiles read as a dashboard
// rather than four identical boxes — the colour identifies the metric family at a
// glance, and it is derived from ONE token per tile so tint, chip and glow can
// never drift apart.
//
// MIN_HEIGHT is fixed on purpose: these tiles are the first thing on most pages,
// and a tile that grows when its value arrives pushes the whole page down (the
// CLS rule in CLAUDE.md). MetricTileSkeleton occupies exactly the same box.

const MIN_HEIGHT = 108;

const TONE_TOKEN: Record<StatusTone, string> = {
  ok: "var(--zw-ok)",
  watch: "var(--zw-watch)",
  risk: "var(--zw-risk)",
  neutral: "var(--zw-neutral)",
};

export interface MetricTileProps {
  /** Short, uppercase-rendered caption — "Aktive Zähler", "Peak Boost", … */
  label: string;
  /** The number/quantity itself. Already formatted (de-DE) by the caller. */
  value: ReactNode;
  /** One line of context under the value: unit, delta, freshness. */
  hint?: ReactNode;
  /** Tabler icon element, rendered inside the tinted chip. */
  icon?: ReactNode;
  /** Verdict this tile reports, if any — tints the whole tile in the status hue. */
  tone?: StatusTone;
  /**
   * Explicit hue, for tiles standing for one specific thing whose colour is
   * itself data (a meter's own colour, a chart series). Wins over `tone`;
   * defaults to the ambient app accent.
   */
  accent?: string;
  className?: string;
}

export function MetricTile({
  label,
  value,
  hint,
  icon,
  tone,
  accent,
  className,
}: MetricTileProps) {
  const hue = accent ?? (tone ? TONE_TOKEN[tone] : "var(--zw-accent)");

  return (
    <div
      className={cn(
        "panel group/tile flex flex-col justify-between gap-2.5 overflow-hidden p-4",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-panel-lg",
        className,
      )}
      style={{ minHeight: MIN_HEIGHT, "--tile-hue": hue } as CSSProperties}
    >
      {/* Hue wash: a soft glow anchored top-right, behind the content. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--tile-hue) 22%, transparent), transparent 62%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className="legend-label pt-1 truncate">{label}</span>
        {icon && (
          <span
            className="grid size-9 flex-none place-items-center rounded-control"
            style={{
              color: "var(--tile-hue)",
              background: "color-mix(in srgb, var(--tile-hue) 16%, transparent)",
              boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--tile-hue) 26%, transparent)",
            }}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="relative">
        <div className="readout truncate text-readout">{value}</div>
        {hint !== undefined && (
          <div className="mt-1 truncate text-xs text-dim">{hint}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Stand-in with the tile's exact geometry, for KPIs that resolve after mount.
 * Same box in, same box out — swapping it for the real tile shifts nothing.
 */
export function MetricTileSkeleton() {
  return (
    <div
      className="panel flex flex-col justify-between gap-2.5 overflow-hidden p-4"
      style={{ minHeight: MIN_HEIGHT }}
    >
      <div className="flex items-start justify-between gap-3">
        <Skeleton height={10} width={78} className="mt-1" />
        <Skeleton height={36} width={36} className="rounded-control" />
      </div>
      <div>
        <Skeleton height={24} width={64} />
        <Skeleton height={10} width={96} className="mt-2" />
      </div>
    </div>
  );
}
