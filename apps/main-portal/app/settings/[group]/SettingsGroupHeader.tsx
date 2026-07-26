import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import { PageHeader } from "@/app/components/ui/primitives";
import type { SettingsGroup } from "../groups";

// Header for a settings sub-page: a way back to the index, then the usual
// PageHeader. The back link is a real <Link>, not history.back() — arriving here
// from search or from the navigation menu is now an ordinary thing to do, and
// "back" then means the browser's previous page, which may be anywhere.
export function SettingsGroupHeader({ group }: { group: SettingsGroup }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] text-dim transition-colors hover:text-ink sm:min-h-9"
      >
        <IconChevronLeft size={16} stroke={2} className="flex-none" />
        Plattform-Einstellungen
      </Link>
      <PageHeader title={group.title} description={group.description} />
    </div>
  );
}
