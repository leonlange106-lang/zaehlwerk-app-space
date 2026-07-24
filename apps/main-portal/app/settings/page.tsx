import { prisma } from "@zaehlwerk/database";
import { getCurrentVersionInfo } from "@/app/lib/version";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { listUsers } from "@/app/lib/user-actions";
import { listApiTokens } from "@/app/lib/api-token-actions";
import { listIngestionKeys } from "@/app/lib/ingestion-key-actions";
import { listAuditEvents } from "@/app/lib/audit";
import { listSnapshots } from "@/app/lib/backup-engine";
import { getDatabaseStats } from "@/app/lib/db-maintenance";
import { getBackupPolicy } from "@/app/lib/settings";
import { SettingsView } from "./SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [versionInfo, currentUser] = await Promise.all([
    getCurrentVersionInfo(),
    getSessionUser(),
  ]);

  const isAdmin = currentUser?.role === "ADMIN";

  const [users, twoFactorEnabled, apiTokens, ingestionKeys, governance] = await Promise.all([
    isAdmin ? listUsers() : Promise.resolve([]),
    currentUser
      ? prisma.user
          .findUnique({ where: { id: currentUser.id }, select: { twoFactorEnabled: true } })
          .then((u) => u?.twoFactorEnabled ?? false)
      : Promise.resolve(false),
    currentUser ? listApiTokens() : Promise.resolve([]),
    isAdmin ? listIngestionKeys() : Promise.resolve([]),
    isAdmin
      ? Promise.all([getBackupPolicy(), listSnapshots(), getDatabaseStats(), listAuditEvents(100)]).then(
          ([policy, snapshots, dbStats, auditEvents]) => ({ policy, snapshots, dbStats, auditEvents }),
        )
      : Promise.resolve(null),
  ]);

  return (
    <SettingsView
      versionInfo={versionInfo}
      currentUser={currentUser}
      users={users}
      twoFactorEnabled={twoFactorEnabled}
      apiTokens={apiTokens}
      ingestionKeys={ingestionKeys}
      governance={governance}
    />
  );
}
