"use client";

import type { ReactNode } from "react";
import { Drawer, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import classes from "./ResponsiveDialog.module.css";

// One dialog primitive, two presentations.
//
// A centred Modal is a desktop idiom: on a 390px phone it lands mid-screen,
// far from the thumb, and its buttons end up in the hardest-to-reach corner.
// Below `sm` this renders a bottom sheet instead — anchored to the bottom edge,
// within thumb reach, dismissed by the same tap-outside/Escape affordances.
// Above `sm` it is the familiar centred Modal.
//
// Both branches render `role="dialog"` with the same accessible name, so
// callers, tests and assistive tech see one component, not two.

/** Mantine's `sm` breakpoint (48em). Below it, phones get the bottom sheet. */
const PHONE_QUERY = "(max-width: 48em)";

export interface ResponsiveDialogProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Modal width on desktop. Ignored by the mobile sheet, which is full-width. */
  size?: string | number;
  /** Block dismissal while a submit is in flight. */
  closeDisabled?: boolean;
  "data-testid"?: string;
}

export function ResponsiveDialog({
  opened,
  onClose,
  title,
  children,
  size = "md",
  closeDisabled = false,
  "data-testid": testId,
}: ResponsiveDialogProps) {
  // The dialog only mounts after a user interaction, so reading matchMedia
  // during the first render is safe here — there is no server-rendered markup
  // to disagree with, and it avoids a mount-then-swap flash.
  const isPhone = useMediaQuery(PHONE_QUERY, false, { getInitialValueInEffect: true });

  const handleClose = closeDisabled ? () => undefined : onClose;

  if (isPhone) {
    return (
      <Drawer
        opened={opened}
        onClose={handleClose}
        position="bottom"
        title={title}
        classNames={{ content: classes.sheet, body: classes.sheetBody }}
        closeButtonProps={{ size: "lg", "aria-label": "Schließen" }}
        data-testid={testId}
      >
        {children}
      </Drawer>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={title}
      size={size}
      centered
      data-testid={testId}
    >
      {children}
    </Modal>
  );
}
