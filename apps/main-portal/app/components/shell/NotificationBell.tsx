"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import {
  IconAlertTriangle,
  IconBell,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Spinner } from "@/app/components/ui/primitives";
import { OVERLAY_MOTION } from "@/app/components/ui/primitives";
import type { NotificationItem, NotificationTone } from "@/app/lib/notifications";
import { cn } from "@/app/lib/cn";

// The bell, which until now was a button with an aria-label and no handler —
// something that looks like a control and is not one.
//
// What it reports is DERIVED from state the platform already keeps (update
// available, backup overdue, maintenance overdue), so an item disappears when
// its cause does. That is the difference from `Toast`: toasts are for things
// that just happened and are then gone, and the § 7.2 note is right that
// notifications without a read/unread state are only toasts with extra steps.
// Read markers are per user and persist; see lib/notification-source.ts.

const TONE_ICON: Record<NotificationTone, typeof IconBell> = {
  risk: IconAlertTriangle,
  watch: IconAlertTriangle,
  neutral: IconInfoCircle,
};

const TONE_CLASS: Record<NotificationTone, string> = {
  risk: "text-risk",
  watch: "text-watch",
  neutral: "text-accent",
};

/** Refresh while the tab is open, so a backup going overdue shows up without a
 *  reload. Long, because every item is a slow-moving condition. */
const POLL_MS = 5 * 60 * 1000;

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/notifications");
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { items: NotificationItem[]; unread: number };
        // Guarded: a poll in flight when the shell unmounts (sign-out) would
        // otherwise write to a component that is gone.
        if (!alive) return;
        setItems(body.items);
        setUnread(body.unread);
      } catch {
        // A failed poll must not empty a list that is still valid on screen.
      } finally {
        if (alive) setLoading(false);
      }
    };

    // Every setState above sits behind an `await fetch`, so nothing is written
    // during this effect's synchronous body — the poll is a subscription to an
    // external system, not derived state.
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Opening the drawer is the act of reading. Marked here rather than behind a
  // separate button: an unread badge that survives looking at the list is a nag.
  //
  // Driven by the STATE (open && unread > 0) rather than by the open transition.
  // Keying it to the click meant a bell opened before the first poll returned
  // saw `unread === 0`, sent nothing, and then showed a badge the moment the
  // poll landed — for a list already on screen. It also covers an item that
  // arrives while the drawer is open.
  useEffect(() => {
    if (!open || unread === 0) return;
    let alive = true;
    void fetch("/api/notifications", { method: "POST" })
      .then(() => {
        // Cleared on confirmation, not optimistically: if the write fails the
        // badge stays, which is the right direction to fail in.
        if (alive) setUnread(0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, unread]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            unread > 0 ? `Benachrichtigungen – ${unread} ungelesen` : "Benachrichtigungen"
          }
          data-testid="notification-bell"
          className={cn(
            "relative flex size-11 flex-none items-center justify-center rounded-full transition-colors sm:size-9",
            open ? "bg-elevated text-ink" : "text-dim hover:bg-elevated hover:text-ink",
          )}
        >
          <IconBell size={18} stroke={1.6} />
          {unread > 0 && (
            <span
              data-testid="notification-count"
              // Count, not a bare dot: "3 things need you" and "something is
              // different" are not the same message. Paired with the number in
              // the aria-label, so it is never colour alone.
              className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-risk px-1 text-[10px] font-bold leading-4 text-white sm:right-0 sm:top-0"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          data-testid="notification-drawer"
          className={cn(
            "z-50 w-[min(88vw,22rem)] max-h-[min(70vh,28rem)] overflow-y-auto",
            "rounded-panel border border-line bg-elevated/95 p-1.5 shadow-panel-lg backdrop-blur-xl",
            OVERLAY_MOTION,
          )}
        >
          <p className="legend-label px-3 py-2">Benachrichtigungen</p>

          {loading && items.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-dim">
              <Spinner size={14} label="Wird geladen" />
              Wird geprüft…
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="flex items-center gap-2.5 px-3 py-4 text-[13px] text-dim">
              <IconCircleCheck size={16} className="flex-none text-ok" />
              Alles in Ordnung — nichts liegt an.
            </div>
          )}

          {items.map((item) => (
            <Row key={item.id} item={item} onNavigate={() => setOpen(false)} />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  const Icon = TONE_ICON[item.tone];
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="flex min-h-11 w-full items-start gap-3 rounded-control px-3 py-2.5 text-left transition-colors hover:bg-canvas"
    >
      {/* The icon carries the severity next to the colour — a colour-only
          verdict is unreadable in greyscale and to red-green deficiency, the
          same rule StatusBadge exists to enforce. */}
      <Icon size={16} stroke={1.7} className={cn("mt-0.5 flex-none", TONE_CLASS[item.tone])} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold">{item.title}</span>
        <span className="text-[12px] leading-snug text-dim">{item.body}</span>
      </span>
    </Link>
  );
}
