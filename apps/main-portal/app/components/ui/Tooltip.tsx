"use client";

import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/app/lib/cn";
import { OVERLAY_MOTION } from "./primitives";

// Hover/focus hint. Radix handles the delay, the collision flipping and — the
// part that is easy to get wrong — keyboard focus, so the hint is reachable
// without a pointer.
//
// A tooltip is never the only place information lives: it disappears on touch,
// where there is no hover at all. Anything a user must know needs a visible
// label; this is for the icon button whose meaning is already implied.

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[70] rounded-control border border-line bg-elevated px-2.5 py-1.5 text-[12px] shadow-panel",
            OVERLAY_MOTION,
          )}
        >
          {label}
          <RadixTooltip.Arrow className="fill-[var(--zw-elevated)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
