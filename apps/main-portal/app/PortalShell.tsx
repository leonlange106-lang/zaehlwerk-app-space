"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  IconBell,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
  IconSunMoon,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS } from "@zaehlwerk/database/client";
import type { UserRole } from "@zaehlwerk/database/client";
import { activeAppFor } from "./lib/apps";
import { AppMenu } from "./components/shell/AppMenu";
import { GlobalSearch } from "./components/shell/GlobalSearch";
import { useColorScheme } from "./components/shell/ThemeProvider";
import { OVERLAY_MOTION } from "./components/ui/primitives";
import { cn } from "./lib/cn";

// The app shell: a translucent header bar over the deck. That is the whole thing.
//
// There is deliberately no pinned section rail any more, and no second menu. The
// shell used to carry both a grid icon that switched apps and a burger that (on
// phones only) listed the current app's sections, so "how do I get somewhere"
// depended on where that somewhere was and on how wide the window happened to be.
// Navigation is now exactly one control — see components/shell/AppMenu — which
// drills from the app list down to an individual meter and behaves identically at
// every width. The deck gets the reclaimed space.
//
// The active app is signalled by the accent gradient rather than by a label you
// have to read: the brand chip and the avatar carry it, and it re-points per app
// (cyan→blue for Zählwerk, amber→orange for the Log Analyzer) via [data-app] in
// globals.css.

// Auth screens render standalone (no nav/header chrome).
const BARE_PATHS = ["/login", "/setup"];

// Detect "embedded" mode: the app is shown inside another frame — chiefly Home
// Assistant Ingress, which renders the add-on in an iframe under the HA panel
// (that already carries its own title/chrome). Purely client-side, so it needs no
// Suspense boundary or server plumbing.
function useEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmbedded(detectEmbedded());
  }, []);
  return embedded;
}

function detectEmbedded(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embedded") === "true") {
      try {
        sessionStorage.setItem("zw:embedded", "1");
      } catch {
        /* storage unavailable — frame detection below still applies */
      }
    }
    let remembered = false;
    try {
      remembered = sessionStorage.getItem("zw:embedded") === "1";
    } catch {
      remembered = false;
    }
    return window.self !== window.top || remembered;
  } catch {
    // Cross-origin access to window.top throws → we are inside a foreign frame.
    return true;
  }
}

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || source[0]!.toUpperCase();
}

const THEME_LABEL = {
  auto: "automatisch (Systemeinstellung)",
  light: "hell",
  dark: "dunkel",
} as const;

/** Round control in the header bar. 44px thumb area on phones, compact above. */
const controlBox =
  "flex flex-none items-center justify-center rounded-full text-dim transition-colors " +
  "hover:bg-elevated hover:text-ink size-11 sm:size-9";

const menuPanel =
  "z-50 overflow-hidden rounded-panel border border-line bg-elevated/95 p-1.5 " +
  "shadow-panel-lg backdrop-blur-xl " +
  OVERLAY_MOTION;

const menuItem =
  "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 text-[13px] outline-none " +
  "min-h-11 sm:min-h-9 transition-colors data-[highlighted]:bg-canvas " +
  "data-[disabled]:cursor-default data-[disabled]:opacity-45";

export function PortalShell({
  children,
  version,
  allowedAppIds,
}: {
  children: React.ReactNode;
  version: { shortSha: string; branch: string } | null;
  allowedAppIds: string[];
}) {
  const pathname = usePathname();
  const { mode, cycleMode } = useColorScheme();
  const { data: session } = useSession();
  const embedded = useEmbedded();

  const activeApp = activeAppFor(pathname);
  const activeAppId = activeApp?.id;

  // Mirror the app context onto <html>: Radix portals menus and dialogs to
  // document.body, outside the shell, where they would otherwise fall back to the
  // root accent and show, say, a cyan row in a menu opened inside the (orange)
  // Log Analyzer.
  useEffect(() => {
    const root = document.documentElement;
    if (activeAppId) root.dataset.app = activeAppId;
    else delete root.dataset.app;
  }, [activeAppId]);

  // Login / first-boot setup render without the app chrome.
  if (BARE_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  const user = session?.user;

  return (
    <div className="min-h-screen bg-canvas" data-app={activeApp?.id}>
      <header className="fixed inset-x-0 top-0 z-50 flex h-15 items-center gap-1.5 border-b border-line bg-surface/80 px-2 backdrop-blur-xl sm:px-3">
        <AppMenu allowedAppIds={allowedAppIds} />

        {/* When embedded (e.g. Home Assistant Ingress) the host panel already
            shows a title, so we drop the duplicate brand mark but keep the menu
            so navigation stays fully intact. */}
        {!embedded && (
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 rounded-control px-1 py-1 transition-colors hover:bg-elevated"
            aria-label="Zum App Space"
          >
            <span className="accent-gradient grid size-8 flex-none place-items-center rounded-control shadow-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mark-appspace.svg" alt="App Space" width={19} height={19} />
            </span>
            <span className="truncate text-[15px] font-semibold tracking-tight">
              {activeApp ? activeApp.name : "App Space"}
            </span>
          </Link>
        )}

        {/* `min-w-0` and not `flex-none`: on a phone the search field expands to
            fill the header, and a flex child that refuses to shrink would push
            the rest of the row off-screen instead. */}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <GlobalSearch />

          {/* Three states, so "follow the system" is expressible. The icon names
              the CURRENT mode rather than the next one — a control that shows
              where you are is readable; one that shows where you would go is a
              riddle. The label spells it out for screen readers either way. */}
          <button
            type="button"
            onClick={cycleMode}
            className={controlBox}
            aria-label={`Theme wechseln – aktuell ${THEME_LABEL[mode]}`}
            title={`Theme: ${THEME_LABEL[mode]}`}
          >
            {mode === "auto" ? (
              <IconSunMoon size={18} stroke={1.6} />
            ) : mode === "light" ? (
              <IconSun size={18} stroke={1.6} />
            ) : (
              <IconMoon size={18} stroke={1.6} />
            )}
          </button>

          <button type="button" className={controlBox} aria-label="Benachrichtigungen">
            <IconBell size={18} stroke={1.6} />
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={controlBox} aria-label="Benutzermenü">
                <span className="accent-gradient grid size-8 place-items-center rounded-full text-[11px] font-bold text-white shadow-panel">
                  {initialsFor(user?.name, user?.email)}
                </span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className={cn(menuPanel, "w-56")}>
                <div className="px-3 py-2">
                  <p className="truncate text-[13px] font-semibold">
                    {user?.name ?? user?.email ?? "Angemeldet"}
                  </p>
                  {user?.email && <p className="truncate text-[11px] text-dim">{user.email}</p>}
                  {user?.role && (
                    <p className="legend-label mt-1">{USER_ROLE_LABELS[user.role as UserRole]}</p>
                  )}
                  <p className="mt-2 truncate text-[10px] text-dim">
                    Version {version?.shortSha ?? "dev"} · {version?.branch ?? "lokal"}
                  </p>
                </div>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <DropdownMenu.Item asChild>
                  <Link href="/settings" className={menuItem}>
                    <IconSettings size={15} className="flex-none" />
                    Plattform-Einstellungen
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={cn(menuItem, "text-risk")}
                  onSelect={() => signOut({ callbackUrl: "/login" })}
                >
                  <IconLogout size={15} className="flex-none" />
                  Abmelden
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <main className="min-h-screen px-3 pb-10 pt-[calc(3.75rem+1rem)] sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
