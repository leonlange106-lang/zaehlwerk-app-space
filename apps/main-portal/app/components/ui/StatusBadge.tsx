import type { ReactElement } from "react";
import { Badge, type BadgeProps } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconMinus,
  IconShieldX,
} from "@tabler/icons-react";

// The one sanctioned way to render a status in the App Space.
//
// The design language pairs colour with an icon *always*: green/amber/red alone
// fail for the ~8% of men with a red-green deficiency, and they also vanish in
// a greyscale print of an exported report. Routing every verdict through this
// component means a new status surface cannot forget the icon — there is no API
// here for "colour only".

export type StatusTone = "ok" | "watch" | "risk" | "neutral";

const TONE_META: Record<
  StatusTone,
  { color: string; icon: (size: number) => ReactElement }
> = {
  /** OK / verified. */
  ok: { color: "emerald", icon: (s) => <IconCheck size={s} stroke={2} /> },
  /** Watch / warning — something to keep an eye on, not yet a failure. */
  watch: { color: "amber", icon: (s) => <IconAlertTriangle size={s} stroke={1.75} /> },
  /** Risk / critical — a hard failure or a hardware hazard. */
  risk: { color: "red", icon: (s) => <IconShieldX size={s} stroke={1.75} /> },
  /** Neutral / duplicate / not applicable. */
  neutral: { color: "slate", icon: (s) => <IconMinus size={s} stroke={1.75} /> },
};

/** Icon size per badge size — kept in step so the glyph never crowds the label. */
const ICON_SIZE: Record<string, number> = { xs: 11, sm: 12, md: 13, lg: 15, xl: 16 };

export interface StatusBadgeProps extends Omit<BadgeProps, "color" | "leftSection"> {
  tone: StatusTone;
  /** The verdict, spelled out. Screen readers and greyscale both need the words. */
  label: string;
  /** Mantine's prop types don't carry `data-*`, but E2E hooks on these badges. */
  "data-testid"?: string;
}

export function StatusBadge({
  tone,
  label,
  size = "sm",
  variant = "light",
  ...rest
}: StatusBadgeProps) {
  const meta = TONE_META[tone];
  const iconSize = ICON_SIZE[typeof size === "string" ? size : "sm"] ?? 12;

  return (
    <Badge
      {...rest}
      size={size}
      variant={variant}
      color={meta.color}
      leftSection={meta.icon(iconSize)}
      styles={{ label: { fontWeight: 700, letterSpacing: "0.02em" } }}
    >
      {label}
    </Badge>
  );
}

/** The tone a boolean check maps to — `null` meaning "could not be determined". */
export function toneForCheck(ok: boolean | null): StatusTone {
  if (ok === true) return "ok";
  if (ok === false) return "risk";
  return "neutral";
}
