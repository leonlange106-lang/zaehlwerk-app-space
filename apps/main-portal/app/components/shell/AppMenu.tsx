"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  IconArrowsDiff,
  IconChartBar,
  IconChartHistogram,
  IconChevronLeft,
  IconChevronRight,
  IconClockHour4,
  IconEngine,
  IconGauge,
  IconGitCommit,
  IconLayoutDashboard,
  IconListTree,
  IconSettings,
  IconStack2,
  IconWorldDownload,
} from "@tabler/icons-react";
import { APPS } from "@/app/lib/apps";
import { cn } from "@/app/lib/cn";
import { Skeleton } from "@/app/components/ui/Skeleton";
import type { MenuMeter } from "@/app/api/apps/zaehlwerk/meters/route";

// The single navigation surface of the App Space.
//
// It replaces the two mechanisms this shell used to have — a grid icon that
// switched apps and a burger that (only on phones) listed the current app's
// sections. Having both meant the answer to "how do I get somewhere" depended on
// where that somewhere was, and on how wide your window happened to be.
//
// ONE interaction model on every breakpoint: a drill-down. Opening a level
// replaces the panel's contents and pushes a back row on top, exactly as it does
// on a phone. Radix's own Sub-menus would give a nicer desktop hover-out, but
// then desktop and mobile would behave differently again, which is the thing
// being fixed. The panel keeps `role="menu"`, so keyboard and screen-reader
// semantics come from Radix either way.
//
// Meters are fetched the first time the Zähler level is opened, then cached for
// the session — see api/apps/zaehlwerk/meters.

type Level = { kind: "root" } | { kind: "app"; appId: string } | { kind: "meters" };

interface Entry {
  label: string;
  href?: string;
  icon: typeof IconStack2;
  /** Opens a deeper level instead of navigating. */
  into?: Level;
  exact?: boolean;
  /** Colour dot instead of an icon — used for meters, whose colour is data. */
  dot?: string;
  hint?: string;
}

const APP_SECTIONS: Record<string, Entry[]> = {
  zaehlwerk: [
    { label: "Dashboard", href: "/apps/zaehlwerk", icon: IconLayoutDashboard, exact: true },
    { label: "Zähler", icon: IconStack2, into: { kind: "meters" } },
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

const row =
  "flex w-full cursor-pointer select-none items-center gap-3 rounded-control px-3 text-[13.5px] " +
  "outline-none transition-colors min-h-11 data-[highlighted]:bg-canvas " +
  "data-[disabled]:cursor-default data-[disabled]:opacity-45";

function isActiveHref(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppMenu({ allowedAppIds }: { allowedAppIds: string[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>({ kind: "root" });
  const [meters, setMeters] = useState<MenuMeter[] | null>(null);
  const [metersFailed, setMetersFailed] = useState(false);
  // Survives close/reopen within the session; a nav menu that re-fetches on every
  // open would show a spinner for a list that almost never changes.
  const metersRequested = useRef(false);

  const apps = APPS.filter((app) => allowedAppIds.includes(app.id));

  const loadMeters = useCallback(async () => {
    if (metersRequested.current) return;
    metersRequested.current = true;
    try {
      const res = await fetch("/api/apps/zaehlwerk/meters");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { meters: MenuMeter[] };
      setMeters(body.meters);
    } catch {
      // Let the user retry by reopening rather than stranding them on a spinner.
      metersRequested.current = false;
      setMetersFailed(true);
    }
  }, []);

  const goInto = useCallback(
    (next: Level) => {
      setLevel(next);
      if (next.kind === "meters") void loadMeters();
    },
    [loadMeters],
  );

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Always reopen at the root: resuming three levels deep from last time is
        // disorienting, and the path you took is not state worth preserving.
        // Reset on the close event rather than in an effect watching `open` —
        // that is where the transition actually happens, and the effect form is a
        // synchronous setState inside a render pass.
        if (!next) setLevel({ kind: "root" });
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Navigation öffnen"
          className={cn(
            "flex size-11 flex-none items-center justify-center rounded-control transition-colors sm:size-9",
            open ? "bg-elevated text-ink" : "text-dim hover:bg-elevated hover:text-ink",
          )}
        >
          <IconListTree size={20} stroke={1.7} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className={cn(
            "z-50 w-[min(88vw,320px)] overflow-hidden rounded-panel border border-line",
            "bg-elevated/95 p-1.5 shadow-panel-lg backdrop-blur-xl",
            "max-h-[calc(100vh-5rem)] overflow-y-auto",
          )}
        >
          {level.kind === "root" && (
            <RootLevel apps={apps} pathname={pathname} onInto={goInto} />
          )}

          {level.kind === "app" && (
            <AppLevel
              appId={level.appId}
              pathname={pathname}
              onBack={() => setLevel({ kind: "root" })}
              onInto={goInto}
            />
          )}

          {level.kind === "meters" && (
            <MetersLevel
              meters={meters}
              failed={metersFailed}
              pathname={pathname}
              onBack={() => setLevel({ kind: "app", appId: "zaehlwerk" })}
            />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Back row shown at the top of every level below the root. */
function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <>
      <DropdownMenu.Item
        className={cn(row, "font-semibold")}
        onSelect={(event) => {
          // Keep the menu open — this navigates within the panel, not the app.
          event.preventDefault();
          onBack();
        }}
      >
        <IconChevronLeft size={17} stroke={2} className="flex-none text-dim" />
        {label}
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
    </>
  );
}

/** A row that drills deeper. Chevron on the right says "there is more inside". */
function IntoRow({
  label,
  icon: Icon,
  onInto,
}: {
  label: string;
  icon: typeof IconStack2;
  onInto: () => void;
}) {
  return (
    <DropdownMenu.Item
      className={row}
      onSelect={(event) => {
        event.preventDefault();
        onInto();
      }}
    >
      <Icon size={17} stroke={1.7} className="flex-none text-dim" />
      {label}
      <IconChevronRight size={15} stroke={2} className="ml-auto flex-none text-dim" />
    </DropdownMenu.Item>
  );
}

/** A row that navigates. Active gets the accent gradient, same as everywhere. */
function LinkRow({
  href,
  label,
  icon: Icon,
  dot,
  hint,
  active,
}: {
  href: string;
  label: string;
  icon?: typeof IconStack2;
  dot?: string;
  hint?: string;
  active: boolean;
}) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className={cn(row, active && "accent-gradient font-semibold text-white")}
      >
        {dot ? (
          <span
            aria-hidden
            className="size-2.5 flex-none rounded-full"
            style={{ background: dot }}
          />
        ) : (
          Icon && <Icon size={17} stroke={1.7} className={cn("flex-none", !active && "text-dim")} />
        )}
        <span className="truncate">{label}</span>
        {hint && (
          <span className={cn("ml-auto flex-none text-[11px]", active ? "text-white/75" : "text-dim")}>
            {hint}
          </span>
        )}
      </Link>
    </DropdownMenu.Item>
  );
}

function RootLevel({
  apps,
  pathname,
  onInto,
}: {
  apps: typeof APPS;
  pathname: string;
  onInto: (level: Level) => void;
}) {
  return (
    <>
      <LinkRow
        href="/"
        label="App Space (Start)"
        icon={IconLayoutDashboard}
        active={pathname === "/"}
      />
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      <DropdownMenu.Label className="legend-label px-3 py-1.5">Apps</DropdownMenu.Label>
      {apps.length === 0 ? (
        <DropdownMenu.Item disabled className={row}>
          Keine Apps freigegeben
        </DropdownMenu.Item>
      ) : (
        apps.map((app) =>
          app.available ? (
            <DropdownMenu.Item
              key={app.id}
              className={row}
              onSelect={(event) => {
                event.preventDefault();
                onInto({ kind: "app", appId: app.id });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={app.icon} alt="" width={18} height={18} className="flex-none" />
              {app.name}
              <IconChevronRight size={15} stroke={2} className="ml-auto flex-none text-dim" />
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item key={app.id} disabled className={row}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={app.icon} alt="" width={18} height={18} className="flex-none" />
              {app.name}
              <span className="legend-label ml-auto">Bald</span>
            </DropdownMenu.Item>
          ),
        )
      )}
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      <LinkRow
        href="/settings"
        label="Plattform-Einstellungen"
        icon={IconSettings}
        active={isActiveHref(pathname, "/settings")}
      />
      <LinkRow
        href="/changelog"
        label="Changelog"
        icon={IconGitCommit}
        active={isActiveHref(pathname, "/changelog")}
      />
    </>
  );
}

function AppLevel({
  appId,
  pathname,
  onBack,
  onInto,
}: {
  appId: string;
  pathname: string;
  onBack: () => void;
  onInto: (level: Level) => void;
}) {
  const app = APPS.find((candidate) => candidate.id === appId);
  const sections = APP_SECTIONS[appId] ?? [];
  return (
    <>
      <BackRow label={app?.name ?? "Zurück"} onBack={onBack} />
      {sections.map((entry) =>
        entry.into ? (
          <IntoRow
            key={entry.label}
            label={entry.label}
            icon={entry.icon}
            onInto={() => onInto(entry.into!)}
          />
        ) : (
          <LinkRow
            key={entry.label}
            href={entry.href!}
            label={entry.label}
            icon={entry.icon}
            active={isActiveHref(pathname, entry.href!, entry.exact)}
          />
        ),
      )}
    </>
  );
}

function MetersLevel({
  meters,
  failed,
  pathname,
  onBack,
}: {
  meters: MenuMeter[] | null;
  failed: boolean;
  pathname: string;
  onBack: () => void;
}) {
  return (
    <>
      <BackRow label="Zähler" onBack={onBack} />
      <LinkRow
        href="/apps/zaehlwerk/zaehler"
        label="Alle Zähler"
        icon={IconStack2}
        active={pathname === "/apps/zaehlwerk/zaehler"}
      />
      <DropdownMenu.Separator className="my-1 h-px bg-line" />

      {meters === null && !failed && (
        // Same row height as a real entry, so the list doesn't jump when it lands.
        <div className="flex flex-col gap-1 px-3 py-1" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-11 items-center gap-3">
              <Skeleton height={10} width={10} className="rounded-full" />
              <Skeleton height={11} width={i === 1 ? 96 : 132} />
            </div>
          ))}
        </div>
      )}

      {failed && (
        <p className="px-3 py-3 text-[13px] text-dim">
          Zähler konnten nicht geladen werden. Menü schließen und erneut öffnen.
        </p>
      )}

      {meters?.length === 0 && (
        <p className="px-3 py-3 text-[13px] text-dim">Noch keine Zähler angelegt.</p>
      )}

      {meters?.map((meter) => (
        <LinkRow
          key={meter.id}
          href={`/apps/zaehlwerk/zaehler/${meter.id}`}
          label={meter.name}
          dot={meter.farbe}
          hint={meter.einheit}
          active={pathname === `/apps/zaehlwerk/zaehler/${meter.id}`}
        />
      ))}
    </>
  );
}
