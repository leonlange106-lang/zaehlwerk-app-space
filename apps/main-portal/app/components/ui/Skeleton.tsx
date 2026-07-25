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
  /**
   * Declared explicitly: TypeScript accepts any hyphenated prop on a component
   * without complaint, so an undeclared `data-testid` is silently dropped and
   * the CLS specs would assert against a locator that never existed.
   */
  "data-testid"?: string;
}

export function Skeleton({ className, width, height, "data-testid": testId }: SkeletonProps) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cn("block animate-pulse bg-line-strong/40 rounded-control", className)}
      style={{ width, height }}
    />
  );
}
