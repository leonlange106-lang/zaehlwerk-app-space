import { prisma } from "@zaehlwerk/database";
import { listLocations } from "../lib/zaehler-actions";
import { getCurrentVersionInfo } from "../lib/version";
import { getSessionUser } from "../lib/auth-helpers";
import { listUsers } from "../lib/user-actions";
import { listApiTokens } from "../lib/api-token-actions";
import { EinstellungenView } from "./EinstellungenView";

export const dynamic = "force-dynamic";

export default async function EinstellungenPage() {
  const [locations, versionInfo, currentUser] = await Promise.all([
    listLocations(),
    getCurrentVersionInfo(),
    getSessionUser(),
  ]);

  const isAdmin = currentUser?.role === "ADMIN";

  const [users, twoFactorEnabled, apiTokens] = await Promise.all([
    isAdmin ? listUsers() : Promise.resolve([]),
    currentUser
      ? prisma.user
          .findUnique({ where: { id: currentUser.id }, select: { twoFactorEnabled: true } })
          .then((u) => u?.twoFactorEnabled ?? false)
      : Promise.resolve(false),
    currentUser ? listApiTokens() : Promise.resolve([]),
  ]);

  return (
    <EinstellungenView
      locations={locations}
      versionInfo={versionInfo}
      currentUser={currentUser}
      users={users}
      twoFactorEnabled={twoFactorEnabled}
      apiTokens={apiTokens}
    />
  );
}
