"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  IconArrowsDiff,
  IconChartBar,
  IconChartHistogram,
  IconChevronLeft,
  IconChevronRight,
  IconClockHour4,
  IconDatabase,
  IconEngine,
  IconGauge,
  IconGitCommit,
  IconLayoutDashboard,
  IconListTree,
  IconPlug,
  IconRefresh,
  IconSettings,
  IconShieldLock,
  IconStack2,
  IconUsers,
  IconWorldDownload,
} from "@tabler/icons-react";
import { activeAppFor, APPS } from "@/app/lib/apps";
import { settingsGroupHref, visibleSettingsGroups } from "@/app/settings/groups";
import { cn } from "@/app/lib/cn";
import { Skeleton } from "@/app/components/ui/Skeleton";
import { BetaBadge } from "@/app/components/ui/Badge";
import { OVERLAY_MOTION } from "@/app/components/ui/primitives";
import type { MenuMeter } from "@/app/api/apps/zaehlwerk/meters/route";
import type { MenuLog } from "@/app/api/apps/log-analyzer/named-logs/route";

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
// The two deepest levels are live data and are fetched the first time they are
// opened, then cached for the session — see api/apps/zaehlwerk/meters and
// api/apps/log-analyzer/named-logs. Logs are deliberately filtered to the ones
// the user named: the corpus grows unattended via the watch-folder and the
// ingestion API, and a menu listing every imported filename would stop being one.

type Level =
  | { kind: "root" }
  | { kind: "app"; appId: string }
  | { kind: "meters" }
  | { kind: "logs" }
  | { kind: "settings" };

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
  /** Marks a section that works but may still change shape. */
  beta?: boolean;
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
    { label: "Remote-Import", href: "/apps/log-analyzer/remote", icon: IconWorldDownload, beta: true },
    { label: "Fahrzeug-Profil", href: "/apps/log-analyzer/specs", icon: IconEngine },
    { label: "Log-Übersicht", icon: IconClockHour4, into: { kind: "logs" } },
  ],
};

// The dot repeats the log's hardware-health verdict. It is a second channel next
// to the name, never the only one — the full verdict with its icon lives in the
// overview (components/ui/StatusBadge).
const HEALTH_DOT: Record<string, string> = {
  safe: "var(--zw-ok)",
  caution: "var(--zw-watch)",
  danger: "var(--zw-risk)",
};

const logDateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

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
  // Read here rather than drilled through PortalShell: the role decides only
  // which settings groups this menu offers, and the session is already in
  // context. Hiding a group is convenience, never a control — /settings/<group>
  // re-checks the role on the server.
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>({ kind: "root" });
  // Which way the last level change went, so the incoming panel slides in from
  // the side it conceptually came from. A drill-down that arrives from the same
  // edge as a step back tells you nothing.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [meters, setMeters] = useState<MenuMeter[] | null>(null);
  const [metersFailed, setMetersFailed] = useState(false);
  const [logs, setLogs] = useState<MenuLog[] | null>(null);
  const [logsFailed, setLogsFailed] = useState(false);
  // These guard against DUPLICATE IN-FLIGHT requests, not against re-fetching.
  // The lists are re-read every time their level is opened: naming a log is what
  // promotes it to this menu, so a list cached from before the naming would
  // quietly break the promise the log overview makes on screen. The previously
  // loaded list stays rendered while the new one arrives, so nothing flashes.
  const metersInFlight = useRef(false);
  const logsInFlight = useRef(false);

  const apps = APPS.filter((app) => allowedAppIds.includes(app.id));

  const loadMeters = useCallback(async () => {
    if (metersInFlight.current) return;
    metersInFlight.current = true;
    try {
      const res = await fetch("/api/apps/zaehlwerk/meters");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { meters: MenuMeter[] };
      setMeters(body.meters);
      setMetersFailed(false);
    } catch {
      // Let the user retry by reopening rather than stranding them on a spinner.
      setMetersFailed(true);
    } finally {
      metersInFlight.current = false;
    }
  }, []);

  const loadLogs = useCallback(async () => {
    if (logsInFlight.current) return;
    logsInFlight.current = true;
    try {
      const res = await fetch("/api/apps/log-analyzer/named-logs");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { logs: MenuLog[] };
      setLogs(body.logs);
      setLogsFailed(false);
    } catch {
      setLogsFailed(true);
    } finally {
      logsInFlight.current = false;
    }
  }, []);

  const goBack = useCallback((next: Level) => {
    setDirection("back");
    setLevel(next);
  }, []);

  const goInto = useCallback(
    (next: Level) => {
      setDirection("forward");
      setLevel(next);
      if (next.kind === "meters") void loadMeters();
      if (next.kind === "logs") void loadLogs();
    },
    [loadMeters, loadLogs],
  );

  // Where the menu opens. Inside an app that app's own level, so the sections you
  // are actually near are one tap away and the root is one back-arrow up. Only
  // outside an app (launcher, settings, changelog) is the root the right start.
  //
  // Deliberately NOT the level you were last on: resuming three levels deep from
  // some earlier navigation is disorienting, and the path you took is not state
  // worth preserving.
  const homeLevel = useCallback((): Level => {
    const app = activeAppFor(pathname);
    if (app && allowedAppIds.includes(app.id)) return { kind: "app", appId: app.id };
    return { kind: "root" };
  }, [pathname, allowedAppIds]);

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Computed on OPEN, not on close: the pathname may well have changed
        // since the menu was last closed — usually because the menu itself
        // navigated somewhere.
        if (next) setLevel(homeLevel());
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
            OVERLAY_MOTION,
          )}
        >
          {/* Keyed on the level so React remounts on every change and the CSS
              animation replays — the panel slides in from the side it came
              from. `overflow-x` is hidden on the Content above, so the offset
              is clipped rather than momentarily widening the menu. */}
          <div
            key={`${level.kind}:${level.kind === "app" ? level.appId : ""}`}
            className={cn(
              "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150",
              direction === "forward"
                ? "motion-safe:slide-in-from-right-4"
                : "motion-safe:slide-in-from-left-4",
            )}
          >
          {level.kind === "root" && (
            <RootLevel apps={apps} pathname={pathname} onInto={goInto} />
          )}

          {level.kind === "app" && (
            <AppLevel
              appId={level.appId}
              pathname={pathname}
              onBack={() => goBack({ kind: "root" })}
              onInto={goInto}
            />
          )}

          {level.kind === "meters" && (
            <MetersLevel
              meters={meters}
              failed={metersFailed}
              pathname={pathname}
              onBack={() => goBack({ kind: "app", appId: "zaehlwerk" })}
            />
          )}

          {level.kind === "logs" && (
            <LogsLevel
              logs={logs}
              failed={logsFailed}
              pathname={pathname}
              onBack={() => goBack({ kind: "app", appId: "log-analyzer" })}
            />
          )}

          {level.kind === "settings" && (
            <SettingsLevel
              pathname={pathname}
              isAdmin={isAdmin}
              onBack={() => goBack({ kind: "root" })}
            />
          )}
          </div>
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
  beta,
  active,
  into,
}: {
  href: string;
  label: string;
  icon?: typeof IconStack2;
  dot?: string;
  hint?: string;
  beta?: boolean;
  active: boolean;
  /** Optional: ein Pfeil rechts, der eine Ebene tiefer geht statt zu navigieren. */
  into?: () => void;
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
        {into && (
          // Sitzt IM Link, muss also beides unterdruecken: die Navigation des
          // Links und das Schliessen des Menues durch Radix. Sonst waere der
          // Pfeil nur eine zweite Art, dieselbe Seite zu oeffnen.
          <span
            role="button"
            tabIndex={0}
            aria-label={`${label}: Bereiche anzeigen`}
            className="ml-auto flex size-8 flex-none items-center justify-center rounded-control hover:bg-canvas/40"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              into();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              into();
            }}
          >
            <IconChevronRight
              size={15}
              stroke={2}
              className={active ? "text-white/75" : "text-dim"}
            />
          </span>
        )}
        {beta && <BetaBadge className="ml-auto" />}
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
              // Dieselbe Aktiv-Markierung wie LinkRow. Sie fehlte hier, weil
              // diese Zeilen aufklappen statt zu navigieren — fuer den Leser ist
              // das aber kein Unterschied: Startseite, Changelog und
              // Einstellungen zeigten farbig an, wo man ist, die beiden Apps
              // nicht. Genau die zwei Eintraege, in denen man sich die meiste
              // Zeit befindet.
              className={cn(
                row,
                isActiveHref(pathname, `/apps/${app.id}`) && "accent-gradient font-semibold text-white",
              )}
              onSelect={(event) => {
                event.preventDefault();
                onInto({ kind: "app", appId: app.id });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={app.icon} alt="" width={18} height={18} className="flex-none" />
              {app.name}
              <IconChevronRight
                size={15}
                stroke={2}
                className={cn(
                  "ml-auto flex-none",
                  isActiveHref(pathname, `/apps/${app.id}`) ? "text-white/75" : "text-dim",
                )}
              />
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
      {/* Ein direkter Link, kein Aufklapp-Punkt. Als Ebene gebaut war der Weg
          zur Uebersicht ein Tippen INS Menue plus ein zweites auf "Alle
          Bereiche" — fuer den haeufigsten Fall ("ich will in die
          Einstellungen") ein Umweg. Die Gruppen sind weiterhin einen Tipp
          entfernt, ueber den Pfeil rechts. */}
      <LinkRow
        href="/settings"
        label="Plattform-Einstellungen"
        icon={IconSettings}
        active={isActiveHref(pathname, "/settings")}
        into={() => onInto({ kind: "settings" })}
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
            beta={entry.beta}
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

      {meters === null && !failed && <LoadingRows />}

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

/** Placeholder rows at the real row height, so a landing list doesn't jump. */
function LoadingRows() {
  return (
    <div className="flex flex-col gap-1 px-3 py-1" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex min-h-11 items-center gap-3">
          <Skeleton height={10} width={10} className="rounded-full" />
          <Skeleton height={11} width={i === 1 ? 96 : 132} />
        </div>
      ))}
    </div>
  );
}

function LogsLevel({
  logs,
  failed,
  pathname,
  onBack,
}: {
  logs: MenuLog[] | null;
  failed: boolean;
  pathname: string;
  onBack: () => void;
}) {
  return (
    <>
      <BackRow label="Log-Übersicht" onBack={onBack} />
      <LinkRow
        href="/apps/log-analyzer/history"
        label="Alle Logs"
        icon={IconClockHour4}
        active={pathname === "/apps/log-analyzer/history"}
      />
      <DropdownMenu.Separator className="my-1 h-px bg-line" />

      {logs === null && !failed && <LoadingRows />}

      {failed && (
        <p className="px-3 py-3 text-[13px] text-dim">
          Logs konnten nicht geladen werden. Menü schließen und erneut öffnen.
        </p>
      )}

      {logs?.length === 0 && (
        <p className="px-3 py-3 text-[13px] leading-relaxed text-dim">
          Noch kein Log benannt. In der Log-Übersicht eine Bezeichnung vergeben —
          benannte Logs erscheinen hier.
        </p>
      )}

      {logs?.map((log) => (
        <LinkRow
          key={log.id}
          // Straight into the Analyzer with the log open. This used to point at
          // the history page, where nothing ever read `?log=` — so picking a log
          // in the menu dropped you on the overview and you had to find it again.
          href={`/apps/log-analyzer?log=${encodeURIComponent(log.id)}`}
          label={log.label}
          dot={HEALTH_DOT[log.health] ?? "var(--zw-neutral)"}
          hint={log.recordedAt ? logDateFormatter.format(new Date(log.recordedAt)) : undefined}
          active={pathname === "/apps/log-analyzer"}
        />
      ))}
    </>
  );
}

function SettingsLevel({
  pathname,
  isAdmin,
  onBack,
}: {
  pathname: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  return (
    <>
      <BackRow label="Plattform-Einstellungen" onBack={onBack} />
      <LinkRow
        href="/settings"
        label="Alle Bereiche"
        icon={IconSettings}
        active={pathname === "/settings"}
      />
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      {visibleSettingsGroups(isAdmin).map((group) => (
        <LinkRow
          key={group.id}
          href={settingsGroupHref(group)}
          label={group.title}
          icon={SETTINGS_GROUP_ICON[group.icon]}
          active={pathname === settingsGroupHref(group)}
        />
      ))}
    </>
  );
}

// groups.ts stays React-free so the search route and the server pages can import
// it too; the icon name is resolved to a component here.
const SETTINGS_GROUP_ICON = {
  "shield-lock": IconShieldLock,
  users: IconUsers,
  plug: IconPlug,
  database: IconDatabase,
  refresh: IconRefresh,
} as const;
