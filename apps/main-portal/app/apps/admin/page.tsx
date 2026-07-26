import { IconChip, PageHeader } from "@/app/components/ui/primitives";
import { IconShieldCog } from "@tabler/icons-react";
import { AdminSectionTiles } from "./AdminSectionTiles";

export const dynamic = "force-dynamic";

export default function AdminHomePage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <IconChip size={44}>
          <IconShieldCog size={22} stroke={1.6} />
        </IconChip>
        <PageHeader
          title="Administration"
          description="Was die Plattform gerade tut — getrennt nach der Frage, die man stellt. Einstellungen (wie sie sich verhalten soll) liegen weiterhin unter Plattform-Einstellungen."
        />
      </div>
      <AdminSectionTiles />
    </div>
  );
}
