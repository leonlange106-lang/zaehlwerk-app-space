import type { ReactNode } from "react";
import { cn } from "@/app/lib/cn";

// Small non-verdict label: a category, a source, a maturity marker.
//
// Deliberately separate from StatusBadge, which is the only way to render an
// ok/watch/risk *verdict* and always pairs its colour with an icon. This one
// carries no verdict, so it has no icon requirement — using it for a status
// would quietly bypass that rule.

export type BadgeTone = "neutral" | "accent" | "beta";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-line text-dim",
  accent:
    "border-[color-mix(in_srgb,var(--zw-accent)_40%,transparent)] text-accent " +
    "bg-[color-mix(in_srgb,var(--zw-accent)_12%,transparent)]",
  // Beta reads as "this works, but it is still moving" — deliberately warm and
  // not reusable as a success/warning colour, which belongs to StatusBadge.
  beta:
    "border-[color-mix(in_srgb,var(--zw-watch)_45%,transparent)] text-watch " +
    "bg-[color-mix(in_srgb,var(--zw-watch)_14%,transparent)]",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] flex-none items-center rounded-full border px-2.5",
        "text-[11px] font-semibold uppercase tracking-[0.05em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The maturity marker for features that work but may still change shape.
 * A single component so every Beta in the product says the same thing the same
 * way, and so they can all be found and retired together.
 */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="beta"
      className={className}
      title="Beta: funktioniert, kann sich aber noch ändern"
    >
      Beta
    </Badge>
  );
}
