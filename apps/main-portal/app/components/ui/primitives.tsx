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
 * Motion
 * ------------------------------------------------------------------ */

/**
 * Enter/exit motion for anything Radix pops over the page: menus, popovers,
 * tooltips.
 *
 * Radix keeps the element mounted while a CSS animation on it is running, so
 * `data-[state=closed]` produces a real exit with no JavaScript and no
 * unmount-timing to get wrong.
 *
 * The slide direction is taken from `data-side`, which Radix sets to whichever
 * side it actually placed the panel on after collision detection. A panel that
 * flipped above its trigger therefore grows downward from it rather than
 * arriving from the wrong direction — the movement says where the thing came
 * from, which is the only reason to animate it at all.
 *
 * A short 2-unit offset on purpose: this is a hint of origin, not a journey.
 * The reduced-motion block in globals.css switches all of it off.
 */
export const OVERLAY_MOTION =
  "duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=open]:fade-in data-[state=closed]:fade-out " +
  "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 " +
  "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 " +
  "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2";

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

/**
 * Indeterminate activity indicator.
 *
 * `role="status"` with a visually hidden label, so a screen reader is told
 * something is running — a bare spinning box announces nothing at all. The
 * animation is already neutralised by the reduced-motion block in globals.css.
 */
export function Spinner({
  size = 16,
  label = "Wird geladen",
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" className={cn("inline-flex flex-none", className)}>
      <span
        aria-hidden
        className="block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        style={{ width: size, height: size }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Determinate progress bar. The percentage must also exist as text nearby. */
export function Progress({
  value,
  label,
  tone = "accent",
  className,
  "data-testid": testId,
}: {
  value: number;
  label: string;
  tone?: "accent" | "ok" | "risk";
  className?: string;
  /** Declared explicitly: TypeScript does not flag unknown hyphenated props on a
   *  component, so an undeclared data-* silently vanishes instead of erroring. */
  "data-testid"?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-testid={testId}
      className={cn("block h-1.5 overflow-hidden rounded-full bg-inset", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full transition-[width] duration-300",
          tone === "accent" && "accent-gradient",
          tone === "ok" && "bg-ok",
          tone === "risk" && "bg-risk",
        )}
        style={{ width: `${pct}%` }}
      />
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
  onDismiss,
  "data-testid": testId,
}: {
  tone?: AlertTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "status" | "alert";
  /** Renders a close button. Omit for alerts the user cannot dismiss. */
  onDismiss?: () => void;
  /** Declared explicitly — see the note on Badge. */
  "data-testid"?: string;
}) {
  const token = ALERT_TOKEN[tone];
  return (
    <div
      role={role}
      data-testid={testId}
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
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-1", "text-dim")}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Meldung schließen"
          className="-m-1 flex size-7 flex-none items-center justify-center rounded-control text-dim transition-colors hover:bg-canvas hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden fill="none">
            <path
              d="M1 1l11 11M12 1L1 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
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
        // `relative` for the same reason as SegmentedControl's label: it keeps
        // the sr-only file input's containing block on this label.
        "relative inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control",
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
 * On/off control with its label and explanation attached.
 *
 * A checkbox under the hood, restyled: the role is the same, so it needs none of
 * the ARIA a hand-built div-switch would, and it works inside a form without
 * extra wiring. The knob moves on a transform, which the reduced-motion block in
 * globals.css already neutralises.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3",
        disabled && "cursor-default opacity-55",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-6 w-11 flex-none items-center rounded-full border p-0.5 transition-colors",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
          checked ? "accent-gradient border-transparent" : "border-line bg-inset",
        )}
      >
        <span
          className={cn(
            "size-4.5 rounded-full bg-white shadow-panel transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-dim">{description}</span>}
      </span>
    </label>
  );
}

/**
 * Pill bar for switching between mutually exclusive views. Radio inputs rather
 * than buttons, so it is one tab stop with arrow-key movement and announces as a
 * group — the mobile specs locate it by `role="radiogroup"`.
 *
 * Two or three short options are the common case, but the overlay-channel picker
 * has eight and one of them is "Zündwinkel-Korrektur". So the bar SCROLLS rather
 * than squeezing: `basis-0 grow` gives every option the same width while they
 * fit, `min-w-fit` stops them shrinking past their own text, and the row then
 * overflows into a horizontal scroll instead of the segments sliding over each
 * other. Truncating to "Zündwinke…" would be worse — the whole point of the
 * control is that you can read the choices.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
  "data-testid": testId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
  /** Disables every option — the group still renders, so nothing reflows. */
  disabled?: boolean;
  "data-testid"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "well flex w-full gap-1 overflow-x-auto rounded-full p-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              // `relative` is load-bearing, not decoration: the visually hidden
              // radio inside is `position: absolute`, and without a positioned
              // label its containing block becomes the enclosing panel. An
              // absolutely positioned box is only clipped by ancestors in its
              // containing-block chain — so once this bar scrolls, those hidden
              // inputs escaped the scroll container, landed at x≈600 and dragged
              // the whole page into horizontal scroll.
              "relative flex min-h-10 min-w-fit shrink grow basis-0 items-center justify-center rounded-full px-3",
              "text-[13px] font-medium whitespace-nowrap transition-colors",
              disabled ? "cursor-default" : "cursor-pointer",
              active ? "accent-gradient text-white shadow-panel" : "text-dim hover:text-ink",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              checked={active}
              disabled={disabled}
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
