"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/app/lib/cn";

// One dialog primitive, two presentations.
//
// A centred panel is a desktop idiom: on a 390px phone it lands mid-screen, far
// from the thumb, and its buttons end up in the hardest-to-reach corner. Below
// `sm` this renders a bottom sheet instead — anchored to the bottom edge, within
// thumb reach, dismissed by the same tap-outside/Escape affordances.
//
// The switch is now a MEDIA QUERY, not a hook. The previous version read
// `useMediaQuery`, which resolves after mount: the dialog rendered as one shape
// and then swapped to the other. Two classes on one element cost nothing and are
// correct on the first frame — the layout rule in CLAUDE.md.
//
// Both shapes are the same element with the same `role="dialog"` and accessible
// name, so callers, tests and assistive tech see one component. Radix supplies
// what is genuinely hard: focus trap, scroll lock, Escape, click-outside, and
// the aria wiring from the title.

export interface ResponsiveDialogProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Panel width on desktop. Ignored by the sheet, which is full-width. */
  size?: "sm" | "md" | "lg";
  /** Block dismissal while a submit is in flight. */
  closeDisabled?: boolean;
  /** Sticky action row, pinned so it stays reachable while the body scrolls. */
  footer?: ReactNode;
  "data-testid"?: string;
}

const SIZE: Record<NonNullable<ResponsiveDialogProps["size"]>, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
};

export function ResponsiveDialog({
  opened,
  onClose,
  title,
  children,
  size = "md",
  closeDisabled = false,
  footer,
  "data-testid": testId,
}: ResponsiveDialogProps) {
  return (
    <Dialog.Root
      open={opened}
      onOpenChange={(next) => {
        if (!next && !closeDisabled) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          data-testid={testId}
          // While a submit is in flight, Escape and outside-clicks are ignored —
          // `onOpenChange` already refuses, but preventing here also stops Radix
          // from animating out and back.
          onEscapeKeyDown={(event) => closeDisabled && event.preventDefault()}
          onPointerDownOutside={(event) => closeDisabled && event.preventDefault()}
          className={cn(
            "fixed z-[60] flex flex-col border border-line bg-elevated shadow-panel-lg",
            // Sheet: bottom-anchored, full width, rounded at the top only, capped
            // so a long form scrolls inside instead of running off-screen.
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-panel",
            // Panel: centred from `sm` up.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-3rem)]",
            "sm:max-h-[85dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel",
            SIZE[size],
          )}
        >
          <div className="flex flex-none items-start justify-between gap-3 border-b border-line px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Schließen"
              disabled={closeDisabled}
              className="-mr-1 -mt-1 grid size-9 flex-none place-items-center rounded-full text-dim transition-colors hover:bg-canvas hover:text-ink disabled:opacity-40"
            >
              <IconX size={17} stroke={1.8} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex flex-none justify-end gap-2 border-t border-line px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-3.5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
