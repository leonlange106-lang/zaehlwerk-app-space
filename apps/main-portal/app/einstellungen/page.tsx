import { listLocations } from "../lib/zaehler-actions";
import { getCurrentVersionInfo } from "../lib/version";
import { getSessionUser } from "../lib/auth-helpers";
import { listUsers } from "../lib/user-actions";
import { EinstellungenView } from "./EinstellungenView";

export const dynamic = "force-dynamic";

export default async function EinstellungenPage() {
  const [locations, versionInfo, currentUser] = await Promise.all([
    listLocations(),
    getCurrentVersionInfo(),
    getSessionUser(),
  ]);

  // Only admins get (and are shown) the user list — listUsers() re-checks too.
  const users = currentUser?.role === "ADMIN" ? await listUsers() : [];

  return (
    <EinstellungenView
      locations={locations}
      versionInfo={versionInfo}
      currentUser={currentUser}
      users={users}
    />
  );
}
