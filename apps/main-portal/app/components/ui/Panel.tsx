import type { ReactNode } from "react";
import { cn } from "@/app/lib/cn";

// The standard container: a glass plate on the deck. Every screen's content sits
// in one of these, which is what makes the language read as one system rather
// than as a per-page decision.
//
// The header row is part of the component on purpose. Titles were previously
// spelled out at each call site with their own spacing, and they drifted — this
// way a panel title is always the same size, weight and distance from its body.

export interface PanelProps {
  /** Omit for a bare plate (no header row). */
  title?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Icon rendered in a tinted chip beside the title. */
  icon?: ReactNode;
  /** Right-aligned slot in the header row — a link, a badge, a control. */
  action?: ReactNode;
  /** Hue for the icon chip. Defaults to the ambient app accent. */
  accent?: string;
  children: ReactNode;
  className?: string;
  /** Drop the default padding, for panels whose child manages its own (tables). */
  bare?: boolean;
}

export function Panel({
  title,
  description,
  icon,
  action,
  accent,
  children,
  className,
  bare,
}: PanelProps) {
  return (
    <section className={cn("panel flex flex-col", bare ? "p-0" : "p-5", className)}>
      {(title || action) && (
        <header
          className={cn(
            "flex items-start justify-between gap-3",
            bare && "px-5 pt-5",
            children ? "mb-4" : "",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span
                className="grid size-9 flex-none place-items-center rounded-control"
                style={{
                  color: accent ?? "var(--zw-accent)",
                  background: `color-mix(in srgb, ${accent ?? "var(--zw-accent)"} 16%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent ?? "var(--zw-accent)"} 26%, transparent)`,
                }}
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
              )}
              {description && <p className="mt-0.5 text-xs text-dim">{description}</p>}
            </div>
          </div>
          {action && <div className="flex flex-none items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
