import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/app/lib/cn";

// The small, unremarkable pieces of the design language.
//
// They live together because each is a handful of lines and splitting them into
// files would cost more in imports than it buys in navigation. Anything with
// real behaviour (dialogs, menus, toasts, tag editing) gets its own module.
//
// Layout helpers deliberately do NOT exist here: a stack is `flex flex-col gap-N`
// and wrapping that in a component only hides which gap a screen actually uses.

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/** Page title + optional subtitle, in the one size every screen uses. */
export function PageHeader({
  title,
  description,
  action,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-dim">{description}</p>}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </div>
  );
}

/** Inline monospace, for ids, paths and commands. */
export function Code({ className, ...rest }: ComponentProps<"code">) {
  return (
    <code
      {...rest}
      className={cn(
        "well rounded-[6px] px-1.5 py-0.5 font-mono text-[12px] break-all",
        className,
      )}
    />
  );
}

/** Block monospace, for snippets the user copies. */
export function CodeBlock({ className, ...rest }: ComponentProps<"pre">) {
  return (
    <pre
      {...rest}
      className={cn("well overflow-x-auto p-3 font-mono text-[12px] leading-relaxed", className)}
    />
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("h-px border-0 bg-line", className)} />;
}

/* ------------------------------------------------------------------ *
 * Icon chip — the tinted square behind an icon, used on tiles and panels
 * ------------------------------------------------------------------ */

export function IconChip({
  children,
  accent = "var(--zw-accent)",
  size = 36,
  className,
}: {
  children: ReactNode;
  accent?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("grid flex-none place-items-center rounded-control", className)}
      style={{
        width: size,
        height: size,
        color: accent,
        background: `color-mix(in srgb, ${accent} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 26%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Alert
 * ------------------------------------------------------------------ */

export type AlertTone = "info" | "ok" | "watch" | "risk";

const ALERT_TOKEN: Record<AlertTone, string> = {
  info: "var(--zw-accent)",
  ok: "var(--zw-ok)",
  watch: "var(--zw-watch)",
  risk: "var(--zw-risk)",
};

/**
 * A message about the state of things. `tone` tints it, but the icon and the
 * words carry the meaning — an alert is never distinguishable by colour alone,
 * for the same reason StatusBadge always pairs its colour with a glyph.
 */
export function Alert({
  tone = "info",
  icon,
  title,
  children,
  className,
  role = "status",
}: {
  tone?: AlertTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const token = ALERT_TOKEN[tone];
  return (
    <div
      role={role}
      className={cn("flex gap-3 rounded-panel border p-3.5 text-sm", className)}
      style={{
        borderColor: `color-mix(in srgb, ${token} 32%, transparent)`,
        background: `color-mix(in srgb, ${token} 10%, transparent)`,
      }}
    >
      {icon && (
        <span className="mt-px flex-none" style={{ color: token }} aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-1", "text-dim")}>{children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

/**
 * Wrapper that lets a wide table scroll inside its panel instead of widening the
 * page — the horizontal-scroll rule the mobile E2E specs enforce.
 */
export function TableScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...rest }: ComponentProps<"table">) {
  return <table {...rest} className={cn("w-full border-collapse text-sm", className)} />;
}

export function Th({ className, ...rest }: ComponentProps<"th">) {
  return (
    <th
      {...rest}
      className={cn(
        "border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-dim whitespace-nowrap",
        className,
      )}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td {...rest} className={cn("border-b border-line px-3 py-2.5 align-middle", className)} />;
}

/* ------------------------------------------------------------------ *
 * Controls without their own module
 * ------------------------------------------------------------------ */

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-9", className)}>
      <input
        {...rest}
        type="checkbox"
        className="size-4 flex-none accent-[var(--zw-accent)]"
      />
      {label}
    </label>
  );
}

/**
 * File picker. A bare `<input type=file>` cannot be styled, so the input is
 * visually hidden inside the label and the label carries the button's look —
 * which keeps it keyboard-reachable, unlike a click-forwarding button would.
 */
export function FilePicker({
  children,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type" | "className"> & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control",
        "border border-line bg-elevated px-4 text-sm font-medium transition-colors",
        "hover:border-line-strong hover:bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        "sm:min-h-10",
        className,
      )}
    >
      <input {...rest} type="file" className="sr-only" />
      {children}
    </label>
  );
}

/**
 * Pill bar for switching between mutually exclusive views. Radio inputs rather
 * than buttons, so it is one tab stop with arrow-key movement and announces as a
 * group — the mobile specs locate it by `role="radiogroup"`.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("well flex w-full gap-1 rounded-full p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-full px-3",
              "text-[13px] font-medium transition-colors",
              active ? "accent-gradient text-white shadow-panel" : "text-dim hover:text-ink",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              checked={active}
              onChange={() => onChange(option.value)}
              value={option.value}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
