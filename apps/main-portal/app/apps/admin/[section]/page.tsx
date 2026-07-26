import { notFound } from "next/navigation";
import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import { PageHeader } from "@/app/components/ui/primitives";
import { adminSectionBySlug } from "../sections";
import { AdminPanel } from "@/app/AdminPanel";
import { AdminTrafficSection } from "../AdminTrafficSection";
import { AdminDatabaseSection } from "../AdminDatabaseSection";
import { AdminActivitySection } from "../AdminActivitySection";

export const dynamic = "force-dynamic";

// Eine Route fuer alle Bereiche — dieselbe Bauform wie settings/[group].
// Unterschiedlich ist nur, welche Bausteine ein Bereich zeigt und welche Daten
// er dafuer laedt; fuenf fast gleiche Ordner waeren fuenf Kopien von Guard,
// Kopfzeile und Not-Found.
//
// Die Rolle prueft das Layout darueber. Hier steht bewusst KEINE zweite
// Rollenpruefung: sie waere eine zweite Wahrheit ueber dieselbe Frage, und die
// Guards der einzelnen Datenquellen (requireAdmin in den Actions/Routen) sind
// die Stelle, an der es wirklich zaehlt.

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  const section = adminSectionBySlug(slug);
  if (!section) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/apps/admin"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] text-dim transition-colors hover:text-ink sm:min-h-9"
        >
          <IconChevronLeft size={16} stroke={2} className="flex-none" />
          Administration
        </Link>
        <PageHeader title={section.title} description={section.description} />
      </div>

      {section.id === "system" && <AdminPanel />}
      {section.id === "traffic" && <AdminTrafficSection />}
      {section.id === "database" && <AdminDatabaseSection />}
      {section.id === "activity" && <AdminActivitySection />}
    </div>
  );
}
