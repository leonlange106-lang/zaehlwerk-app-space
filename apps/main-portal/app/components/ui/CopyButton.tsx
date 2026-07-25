"use client";

import { useCallback, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button, type ButtonProps } from "./Button";

// Copy-to-clipboard with a confirmation that decays on its own.
//
// The timer is held in a ref and cleared before each new one: clicking twice in
// quick succession would otherwise leave the first timeout to fire and reset the
// label while the second copy still looks fresh.
//
// `navigator.clipboard` needs a secure context. Over plain HTTP on a LAN — which
// is exactly how this app is often reached — it is undefined, so the failure is
// caught and reported rather than throwing into the void.

export function CopyButton({
  value,
  idleLabel = "Kopieren",
  copiedLabel = "Kopiert",
  variant = "subtle",
  ...rest
}: Omit<ButtonProps, "onClick" | "children"> & {
  value: string;
  idleLabel?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
      timer.current = setTimeout(() => setFailed(false), 4000);
    }
  }, [value]);

  return (
    <Button {...rest} variant={copied ? "primary" : variant} onClick={() => void copy()}>
      {copied ? <IconCheck size={16} stroke={2.2} /> : <IconCopy size={16} stroke={1.8} />}
      {failed ? "Kopieren nicht möglich" : copied ? copiedLabel : idleLabel}
    </Button>
  );
}
