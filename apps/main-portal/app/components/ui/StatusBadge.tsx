import type { ReactElement } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconMinus,
  IconShieldX,
} from "@tabler/icons-react";
import { cn } from "@/app/lib/cn";

// The one sanctioned way to render a status in the App Space.
//
// The design language pairs colour with an icon *always*: green/amber/red alone
// fail for the ~8% of men with a red-green deficiency, and they also vanish in a
// greyscale print of an exported report. Routing every verdict through this
// component means a new status surface cannot forget the icon — there is no API
// here for "colour only".
//
// A verdict is a reading, not chrome, so it is one of the few places colour is
// allowed to carry meaning at all (see the accent rule in globals.css).

export type StatusTone = "ok" | "watch" | "risk" | "neutral";
export type StatusBadgeSize = "xs" | "sm" | "md" | "lg";
/**
 * `subtle` is the etched indicator: tinted fill, hairline, coloured text.
 * `filled` is the lit one — the tone as the background, canvas as the glyph.
 * The pair exists so a screen can rank two verdicts against each other (the Log
 * Analyzer shows hardware health louder than pull validity); it is never a
 * decorative choice.
 */
export type StatusBadgeVariant = "subtle" | "filled";

const TONE_META: Record<
  StatusTone,
  { token: string; icon: (size: number) => ReactElement }
> = {
  /** OK / verified. */
  ok: { token: "var(--zw-ok)", icon: (s) => <IconCheck size={s} stroke={2.25} /> },
  /** Watch / warning — something to keep an eye on, not yet a failure. */
  watch: { token: "var(--zw-watch)", icon: (s) => <IconAlertTriangle size={s} stroke={2} /> },
  /** Risk / critical — a hard failure or a hardware hazard. */
  risk: { token: "var(--zw-risk)", icon: (s) => <IconShieldX size={s} stroke={2} /> },
  /** Neutral / duplicate / not applicable. */
  neutral: { token: "var(--zw-neutral)", icon: (s) => <IconMinus size={s} stroke={2} /> },
};

const SIZE_META: Record<StatusBadgeSize, { box: string; icon: number }> = {
  xs: { box: "h-[20px] px-2 gap-1 text-[10px]", icon: 11 },
  sm: { box: "h-[24px] px-2.5 gap-1.5 text-[11px]", icon: 12 },
  md: { box: "h-[28px] px-3 gap-1.5 text-xs", icon: 14 },
  lg: { box: "h-[32px] px-3.5 gap-2 text-[13px]", icon: 16 },
};

export interface StatusBadgeProps {
  tone: StatusTone;
  /** The verdict, spelled out. Screen readers and greyscale both need the words. */
  label: string;
  size?: StatusBadgeSize;
  variant?: StatusBadgeVariant;
  className?: string;
  /** E2E hooks on these badges. */
  "data-testid"?: string;
}

export function StatusBadge({
  tone,
  label,
  size = "sm",
  variant = "subtle",
  className,
  ...rest
}: StatusBadgeProps) {
  const meta = TONE_META[tone];
  const dims = SIZE_META[size];

  // color-mix keeps one token per tone: fill, hairline and text all derive from
  // it, so recalibrating a status colour stays consistent across both variants.
  // `filled` puts the canvas colour on the glyph, which is near-black on dark and
  // near-white on light — contrast holds in both schemes without a second token.
  const skin =
    variant === "filled"
      ? {
          color: "var(--zw-canvas)",
          borderColor: meta.token,
          backgroundColor: meta.token,
        }
      : {
          color: meta.token,
          borderColor: `color-mix(in srgb, ${meta.token} 38%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${meta.token} 12%, transparent)`,
        };

  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center rounded-full border font-semibold tracking-[0.02em] whitespace-nowrap align-middle",
        dims.box,
        className,
      )}
      style={skin}
    >
      <span className="flex-none" aria-hidden>
        {meta.icon(dims.icon)}
      </span>
      {label}
    </span>
  );
}

/** The tone a boolean check maps to — `null` meaning "could not be determined". */
export function toneForCheck(ok: boolean | null): StatusTone {
  if (ok === true) return "ok";
  if (ok === false) return "risk";
  return "neutral";
}
