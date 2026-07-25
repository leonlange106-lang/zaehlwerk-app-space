import { cn } from "@/app/lib/cn";

// Loading stand-in. Deliberately a dim inset block rather than a sweeping
// shimmer: a plate whose reading hasn't arrived yet should look like an
// unpowered segment, not like an animation playing.
//
// The pulse is CSS-only and already suppressed by the reduced-motion block in
// globals.css.

export interface SkeletonProps {
  className?: string;
  /** Inline width/height for the cases where a utility class would be silly. */
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse bg-line-strong/40 rounded-control", className)}
      style={{ width, height }}
    />
  );
}
