"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { cn } from "@/app/lib/cn";

// Transient notifications.
//
// One consumer today (the Log Analyzer's realtime ingest events), so this is
// deliberately small: a queue, an auto-dismiss timer, and a live region.
//
// `aria-live="polite"` on the container rather than on each toast: a live region
// has to exist in the DOM *before* the content lands, or screen readers announce
// nothing. Adding a region and its text in the same paint is the classic reason
// toasts are silent for assistive tech.

export type ToastTone = "info" | "ok" | "watch" | "risk";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

const TONE_TOKEN: Record<ToastTone, string> = {
  info: "var(--zw-accent)",
  ok: "var(--zw-ok)",
  watch: "var(--zw-watch)",
  risk: "var(--zw-risk)",
};

function toneIcon(tone: ToastTone) {
  if (tone === "ok") return <IconCheck size={16} stroke={2.2} />;
  if (tone === "risk" || tone === "watch") return <IconAlertTriangle size={16} stroke={2} />;
  return <IconInfoCircle size={16} stroke={2} />;
}

const DISMISS_MS = 6000;

interface ToastContextValue {
  show: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }]);
      window.setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Always mounted, even when empty — see the note at the top.
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 top-[calc(3.75rem+0.5rem)] z-[80] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "panel pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3.5",
              // These utilities used to be dead: they come from tw-animate-css,
              // which was not installed, so the toast snapped in. `motion-safe`
              // is belt-and-braces — the reduced-motion block in globals.css
              // already neutralises them.
              "motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:fade-in",
              "motion-safe:duration-200",
            )}
          >
            <span className="mt-px flex-none" style={{ color: TONE_TOKEN[toast.tone] }} aria-hidden>
              {toneIcon(toast.tone)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{toast.title}</p>
              {toast.message && <p className="mt-0.5 text-xs text-dim">{toast.message}</p>}
            </div>
            <button
              type="button"
              aria-label="Meldung schließen"
              onClick={() => dismiss(toast.id)}
              className="-mr-1 -mt-1 grid size-7 flex-none place-items-center rounded-full text-dim transition-colors hover:bg-canvas hover:text-ink"
            >
              <IconX size={14} stroke={2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
