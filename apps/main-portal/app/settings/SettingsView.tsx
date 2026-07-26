import Link from "next/link";
import {
  IconChevronRight,
  IconDatabase,
  IconPlug,
  IconRefresh,
  IconShieldLock,
  IconUsers,
} from "@tabler/icons-react";
import { PageHeader } from "@/app/components/ui/primitives";
import { visibleSettingsGroups, settingsGroupHref, type SettingsGroup } from "./groups";

// The settings index: one tile per group, nothing else.
//
// It used to be every card stacked on one route — **13 629 px** tall on a 390 px
// phone, which is a scroll rather than a screen, and everything past the first
// two cards was effectively unreachable. The cards themselves did not change;
// they moved to /settings/<group>, and this page became the map.
//
// A Server Component on purpose: it holds no state and reads no browser API, so
// there is nothing here to ship to the client. The interactive cards stay client
// components on their own routes, where their JavaScript is only loaded if you
// actually go there.

const GROUP_ICON = {
  "shield-lock": IconShieldLock,
  users: IconUsers,
  plug: IconPlug,
  database: IconDatabase,
  refresh: IconRefresh,
} as const;

export function SettingsView({ isAdmin }: { isAdmin: boolean }) {
  const groups = visibleSettingsGroups(isAdmin);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plattform-Einstellungen"
        description="System & Konten: Sicherheit, Benutzer, API-Zugriff, Backups und Updates. App-spezifische Optionen findest du in den jeweiligen App-Einstellungen."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <GroupTile key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}

function GroupTile({ group }: { group: SettingsGroup }) {
  const Icon = GROUP_ICON[group.icon];
  return (
    <Link
      href={settingsGroupHref(group)}
      data-testid={`settings-group-${group.slug}`}
      className="panel flex min-h-11 items-center gap-3.5 p-4 transition-colors hover:border-line-strong"
    >
      <span className="accent-gradient grid size-10 flex-none place-items-center rounded-control text-white shadow-panel">
        <Icon size={19} stroke={1.7} />
      </span>
      {/* min-w-0 because the description below wraps: without it this flex child
          refuses to shrink under its content and widens the whole card. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{group.title}</span>
        <span className="text-[13px] leading-snug text-dim">{group.description}</span>
      </span>
      <IconChevronRight size={17} stroke={2} className="ml-auto flex-none text-dim" />
    </Link>
  );
}
