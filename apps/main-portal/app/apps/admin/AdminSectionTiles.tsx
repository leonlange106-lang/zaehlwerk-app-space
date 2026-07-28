import Link from "next/link";
import {
  IconActivity,
  IconChevronRight,
  IconDatabase,
  IconServerBolt,
  IconWorld,
} from "@tabler/icons-react";
import { ADMIN_SECTIONS, adminSectionHref, type AdminSection } from "./sections";

// Die Einstiegsseite der Admin-App: eine Kachel je Bereich, sonst nichts.
//
// Kein Zahlenvorgeschmack auf den Kacheln, obwohl es verlockend waere. Ein
// Speicherwert auf der Uebersicht muesste live sein, um zu stimmen — sonst zeigt
// die Einstiegsseite etwas anderes als der Bereich dahinter, und man glaubt der
// falschen Zahl. Diese Seite sagt, WO etwas steht; die Bereiche sagen, WAS.
//
// Server Component: kein Zustand, kein Browser-API-Zugriff, also nichts, was an
// den Client gehen muesste.

const SECTION_ICON = {
  "server-bolt": IconServerBolt,
  world: IconWorld,
  database: IconDatabase,
  activity: IconActivity,
} as const;

export function AdminSectionTiles() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ADMIN_SECTIONS.map((section) => (
        <SectionTile key={section.id} section={section} />
      ))}
    </div>
  );
}

function SectionTile({ section }: { section: AdminSection }) {
  const Icon = SECTION_ICON[section.icon];
  return (
    <Link
      href={adminSectionHref(section)}
      data-testid={`admin-section-${section.slug}`}
      className="panel flex min-h-11 items-center gap-3.5 p-4 transition-colors hover:border-line-strong"
    >
      <span className="accent-gradient grid size-10 flex-none place-items-center rounded-control text-white shadow-panel">
        <Icon size={19} stroke={1.7} />
      </span>
      {/* min-w-0, weil die Beschreibung umbricht: ohne das weigert sich dieses
          Flex-Kind, unter seine Inhaltsbreite zu schrumpfen, und zieht die
          Kachel auf. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{section.title}</span>
        <span className="text-[13px] leading-snug text-dim">{section.description}</span>
      </span>
      <IconChevronRight size={17} stroke={2} className="ml-auto flex-none text-dim" />
    </Link>
  );
}
