import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth-helpers";

export const dynamic = "force-dynamic";

// Der Admin-Bereich haengt an der ROLLE, nicht an einer App-Freigabe. Eine
// Zuweisung in `allowedApps` koennte sonst versehentlich einem Nicht-Admin den
// Zustand der Plattform oeffnen.
//
// Weiterleiten statt werfen, wie `requireAppAccess` es fuer die Fach-Apps tut:
// wer hier nicht hingehoert, landet auf dem Launcher und nicht in einer
// Fehlerseite, die aussieht, als sei etwas kaputt.
//
// Das Layout ist die aeussere Schranke fuer SEITEN. Die Routen und Actions
// darunter pruefen zusaetzlich selbst — ein Layout laeuft nicht, bevor eine
// Server Action ausgefuehrt wird.
export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") redirect("/");
  return <>{children}</>;
}
