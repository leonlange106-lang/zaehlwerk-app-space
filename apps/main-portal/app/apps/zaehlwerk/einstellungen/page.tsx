import { listLocations } from "@/app/lib/zaehler-actions";
import { ZaehlwerkSettingsView } from "./ZaehlwerkSettingsView";

export const dynamic = "force-dynamic";

export default async function ZaehlwerkSettingsPage() {
  const locations = await listLocations();
  return <ZaehlwerkSettingsView locations={locations} />;
}
