"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMantineColorScheme } from "@mantine/core";
import {
  IconArrowsDiff,
  IconBell,
  IconChartBar,
  IconChartHistogram,
  IconClockHour4,
  IconEngine,
  IconGauge,
  IconGitCommit,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStack2,
  IconSun,
  IconWorldDownload,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS } from "@zaehlwerk/database/client";
import type { UserRole } from "@zaehlwerk/database/client";
import { APPS, activeAppFor } from "./lib/apps";
import { cn } from "./lib/cn";

// The app shell: a translucent header bar, a glass section rail and the deck.
//
// Laid out by hand rather than with a framework AppShell, because the shell is
// only three fixed boxes and owning them outright is what lets the mobile drawer,
// its scrim and the sticky KPI rail agree on stacking order instead of
// negotiating with a component library's z-index scale.
//
// The active app is signalled by the accent gradient rather than by a label you
// have to read: the brand chip, the selected rail row and the avatar all carry
// it, and it re-points per app (cyan→blue for Zählwerk, amber→orange for the Log
// Analyzer) via [data-app] in globals.css.

// Auth screens render standalone (no nav/header chrome).
const BARE_PATHS = ["/login", "/setup"];

// Stacking, declared once. The scrim sits BELOW the drawer and the header so the
// drawer's links and the burger stay tappable while it is open; a scrim above
// them swallows every touch and dismisses on any tap.
const Z = { header: "z-50", drawer: "z-50", scrim: "z-40" } as const;

// Width of the pinned section rail from `sm` up. The deck pads itself by this
// plus its own gutter, so the two cannot drift apart.
const RAIL_W = "15.5rem";

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

type NavItem = { label: string; href: string; icon: typeof IconStack2; exact?: boolean };

// Per-app section rail. Keyed by app id; only apps with their own sub-navigation
// appear here, and the rail is shown only inside such an app.
const APP_NAV: Record<string, NavItem[]> = {
  zaehlwerk: [
    { label: "Dashboard", href: "/apps/zaehlwerk", icon: IconLayoutDashboard, exact: true },
    { label: "Zähler", href: "/apps/zaehlwerk/zaehler", icon: IconStack2 },
    { label: "Berichte", href: "/apps/zaehlwerk/berichte", icon: IconChartBar },
    { label: "App-Einstellungen", href: "/apps/zaehlwerk/einstellungen", icon: IconSettings },
  ],
  "log-analyzer": [
    { label: "Analyzer", href: "/apps/log-analyzer", icon: IconChartHistogram, exact: true },
    { label: "Log-Vergleich", href: "/apps/log-analyzer/compare", icon: IconArrowsDiff },
    { label: "Virtueller Prüfstand", href: "/apps/log-analyzer/dyno", icon: IconGauge },
    { label: "Remote-Import", href: "/apps/log-analyzer/remote", icon: IconWorldDownload },
    { label: "Fahrzeug-Profil", href: "/apps/log-analyzer/specs", icon: IconEngine },
    { label: "Log-Übersicht", href: "/apps/log-analyzer/history", icon: IconClockHour4 },
  ],
};

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || source[0]!.toUpperCase();
}

function isActiveHref(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Round control in the header bar. 44px thumb area on phones, compact above. */
const controlBox =
  "flex flex-none items-center justify-center rounded-full text-dim transition-colors " +
  "hover:bg-elevated hover:text-ink size-11 sm:size-9";

const menuPanel =
  "z-50 overflow-hidden rounded-panel border border-line bg-elevated/95 p-1.5 " +
  "shadow-panel-lg backdrop-blur-xl";

const menuItem =
  "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 text-[13px] outline-none " +
  "min-h-11 sm:min-h-9 transition-colors data-[highlighted]:bg-canvas " +
  "data-[disabled]:cursor-default data-[disabled]:opacity-45";

function AppIcon({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={18} height={18} className="flex-none" />;
}

function AppSwitcher({ allowedAppIds }: { allowedAppIds: string[] }) {
  const apps = APPS.filter((app) => allowedAppIds.includes(app.id));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={controlBox} aria-label="App wechseln">
          <IconLayoutGrid size={19} stroke={1.6} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className={cn(menuPanel, "w-64")}>
          <DropdownMenu.Label className="legend-label px-3 py-1.5">Apps</DropdownMenu.Label>
          {apps.length === 0 ? (
            <DropdownMenu.Item disabled className={menuItem}>
              Keine Apps freigegeben
            </DropdownMenu.Item>
          ) : (
            apps.map((app) =>
              app.available ? (
                <DropdownMenu.Item key={app.id} asChild>
                  <Link href={app.href} className={menuItem}>
                    <AppIcon src={app.icon} />
                    {app.name}
                  </Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item key={app.id} disabled className={menuItem}>
                  <AppIcon src={app.icon} />
                  {app.name}
                  <span className="legend-label ml-auto">Bald</span>
                </DropdownMenu.Item>
              ),
            )
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href="/" className={menuItem}>
              <IconLayoutGrid size={16} className="flex-none" />
              App Space (Start)
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/settings" className={menuItem}>
              <IconSettings size={16} className="flex-none" />
              Plattform-Einstellungen
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/changelog" className={menuItem}>
              <IconGitCommit size={16} className="flex-none" />
              Changelog
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * One row in the section rail. The active row is marked by a solid accent spine
 * plus a raised fill and a heavier weight — readable at a glance, and never by
 * colour alone.
 */
function NavRow({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof IconStack2;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active || undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-control px-3 text-[13.5px] transition-all sm:min-h-10",
        active
          ? "accent-gradient font-semibold text-white shadow-panel"
          : "text-dim hover:bg-elevated hover:text-ink",
      )}
    >
      <Icon size={17} stroke={1.6} className="flex-none" />
      {label}
    </Link>
  );
}

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
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { data: session } = useSession();
  const embedded = useEmbedded();

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Navigating on a phone should dismiss the drawer, so the target page is
  // actually visible instead of hidden behind the open overlay. Adjusted during
  // render rather than in an effect: React re-runs this pass immediately with the
  // corrected state, so the drawer is never painted open on the new route (an
  // effect would show one frame of it, and trips the cascading-render rule).
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setMobileOpen(false);
  }

  const activeApp = activeAppFor(pathname);
  const activeAppId = activeApp?.id;

  // Mirror the app context onto <html>: Radix portals menus and dialogs to
  // document.body, outside the shell, where they would otherwise fall back to the
  // root accent and show, say, a cyan marker on a sheet opened inside the
  // (orange) Log Analyzer.
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
  const navItems = activeApp ? APP_NAV[activeApp.id] ?? [] : [];
  const showNavbar = navItems.length > 0;

  return (
    <div className="min-h-screen bg-canvas" data-app={activeApp?.id}>
      <header
        className={cn(
          "fixed inset-x-0 top-0 flex h-15 items-center gap-1.5 border-b border-line px-2 sm:px-3",
          "bg-surface/80 backdrop-blur-xl",
          Z.header,
        )}
      >

        {showNavbar && (
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className={cn(controlBox, "sm:hidden")}
            aria-label="Navigation umschalten"
            aria-expanded={mobileOpen}
          >
            <IconMenu2 size={20} stroke={1.8} />
          </button>
        )}

        <AppSwitcher allowedAppIds={allowedAppIds} />

        {/* When embedded (e.g. Home Assistant Ingress) the host panel already
            shows a title, so we drop the duplicate brand mark but keep the
            switcher and nav so navigation stays fully intact. */}
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

        <div className="ml-auto flex flex-none items-center gap-1.5">
          <label className="relative hidden sm:block">
            <span className="sr-only">Suchen</span>
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim"
            />
            <input
              type="search"
              placeholder="Suchen…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="well h-9 w-[min(340px,26vw)] rounded-full pl-9 pr-3.5 text-[13px] outline-none placeholder:text-dim focus:border-accent"
            />
          </label>

          <button
            type="button"
            onClick={() => toggleColorScheme()}
            className={controlBox}
            aria-label="Theme wechseln"
          >
            {colorScheme === "dark" ? (
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
                  {user?.email && <p className="truncate text-[11px] text-neutral">{user.email}</p>}
                  {user?.role && (
                    <p className="legend-label mt-1">{USER_ROLE_LABELS[user.role as UserRole]}</p>
                  )}
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

      {showNavbar && (
        <>
          <nav
            data-testid="app-navbar"
            data-open={mobileOpen || undefined}
            aria-label="Bereichsnavigation"
            style={{ ["--rail-w" as string]: RAIL_W }}
            className={cn(
              "fixed bottom-0 left-0 top-15 flex w-[min(82vw,300px)] flex-col justify-between gap-3",
              "-translate-x-full border-r border-line bg-surface/80 p-3 backdrop-blur-xl transition-transform duration-200",
              "shadow-[8px_0_32px_rgba(0,0,0,0.5)] data-[open]:translate-x-0",
              "sm:w-(--rail-w) sm:translate-x-0 sm:shadow-none",
              Z.drawer,
            )}
          >
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              <li>
                <NavRow href="/" icon={IconLayoutGrid} label="Alle Apps" active={false} />
              </li>
              {navItems.map((item) => (
                <li key={item.href}>
                  <NavRow
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    active={isActiveHref(pathname, item.href, item.exact)}
                  />
                </li>
              ))}
            </ul>

            <Link
              href="/changelog"
              title="Changelog öffnen"
              className={cn(
                "well flex flex-none items-center gap-2.5 px-3 py-2.5 text-dim transition-colors",
                "hover:border-line-strong hover:text-ink",
                isActiveHref(pathname, "/changelog") && "border-line-strong text-ink",
              )}
            >
              <IconGitCommit size={15} stroke={1.6} className="flex-none" />
              <span className="min-w-0">
                <span className="readout block truncate text-[11px]">
                  Version {version?.shortSha ?? "dev"}
                </span>
                <span className="block truncate text-[10px] leading-tight">
                  {version?.branch ?? "lokal"} · Changelog
                </span>
              </span>
            </Link>
          </nav>

          {/* Tap-to-dismiss scrim behind the open mobile drawer. Without it the
              drawer feels "stuck": you see it, but taps land on the page behind. */}
          {mobileOpen && (
            <div
              className={cn("fixed inset-0 bg-black/55 sm:hidden", Z.scrim)}
              onClick={closeMobile}
              role="presentation"
              aria-hidden
            />
          )}
        </>
      )}

      <main
        style={showNavbar ? ({ ["--rail-w" as string]: RAIL_W } as React.CSSProperties) : undefined}
        className={cn(
          "min-h-screen px-3 pb-10 pt-[calc(3.75rem+1rem)] sm:px-5 lg:px-8",
          // Clears the pinned rail from `sm` up; below that the rail is a drawer
          // and the deck uses the full width.
          showNavbar && "sm:pl-[calc(var(--rail-w)+1rem)] lg:pl-[calc(var(--rail-w)+1.5rem)]",
        )}
      >
        {children}
      </main>
    </div>
  );
}
