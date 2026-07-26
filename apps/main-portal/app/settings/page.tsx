import { getSessionUser } from "@/app/lib/auth-helpers";
import { SettingsView } from "./SettingsView";

export const dynamic = "force-dynamic";

// The index now needs ONE thing — the role, to decide which groups to offer.
//
// It used to load the version info, the user list, the API tokens, the ingestion
// keys, the backup policy, the snapshot list, the database stats and 100 audit
// events, on every visit, because every card lived on this route. Each of those
// reads moved to the sub-page that renders it, so opening the settings no longer
// pays for the eight cards you did not come for.
export default async function SettingsPage() {
  const user = await getSessionUser();
  return <SettingsView isAdmin={user?.role === "ADMIN"} />;
}
