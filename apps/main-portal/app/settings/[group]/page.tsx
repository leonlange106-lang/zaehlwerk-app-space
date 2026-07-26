import { notFound, redirect } from "next/navigation";
import { prisma } from "@zaehlwerk/database";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { getCurrentVersionInfo } from "@/app/lib/version";
import { listUsers } from "@/app/lib/user-actions";
import { listApiTokens } from "@/app/lib/api-token-actions";
import { listIngestionKeys } from "@/app/lib/ingestion-key-actions";
import { listAuditEvents } from "@/app/lib/audit";
import { listSnapshots } from "@/app/lib/backup-engine";
import { getDatabaseStats } from "@/app/lib/db-maintenance";
import {
  getBackupPolicy,
  getEnforceTwoFactor,
  getLogRetentionPolicy,
  getUpdateChannel,
} from "@/app/lib/settings";
import { updateTokenRequired } from "@/app/lib/update-run";
import { settingsGroupBySlug } from "../groups";
import { SettingsGroupHeader } from "./SettingsGroupHeader";
import { SecurityCard } from "../SecurityCard";
import { AuditLogCard } from "../AuditLogCard";
import { UserManagementCard } from "../UserManagementCard";
import { ApiTokenCard } from "../ApiTokenCard";
import { IngestionKeyCard } from "../IngestionKeyCard";
import { SystemBackupCard } from "../SystemBackupCard";
import { BackupPolicyCard } from "../BackupPolicyCard";
import { DatabaseMaintenanceCard } from "../DatabaseMaintenanceCard";
import { UpdateSettingsCard } from "../UpdateSettingsCard";
import { VersionHistoryCard } from "../VersionHistoryCard";

export const dynamic = "force-dynamic";

// One route for all five settings groups.
//
// A single dynamic segment rather than five near-identical folders: the split is
// data (groups.ts), and the only thing that genuinely differs per group is which
// cards to render and which queries to run for them. Five files would have meant
// five copies of the guard, the header and the not-found handling.
//
// **Each branch loads only its own data.** That is the substance of the split,
// not just the layout: the old single page ran every query on every visit.

export default async function SettingsGroupPage({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group: slug } = await params;
  const group = settingsGroupBySlug(slug);
  if (!group) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "ADMIN";

  // The tile is hidden from non-admins, but hiding is not a control: this route
  // is reachable by typing it. Admin-only groups therefore check here too.
  if (group.adminOnly && !isAdmin) notFound();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroupHeader group={group} />
      {group.id === "sicherheit" && <SecurityGroup isAdmin={isAdmin} userId={user.id} />}
      {group.id === "benutzer" && <UserGroup currentUserId={user.id} />}
      {group.id === "integrationen" && <IntegrationsGroup isAdmin={isAdmin} />}
      {group.id === "daten" && <DataGroup />}
      {group.id === "system" && <SystemGroup isAdmin={isAdmin} />}
    </div>
  );
}

async function SecurityGroup({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const [twoFactorEnabled, enforceTwoFactor, auditEvents] = await Promise.all([
    prisma.user
      .findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } })
      .then((row) => row?.twoFactorEnabled ?? false),
    getEnforceTwoFactor(),
    isAdmin ? listAuditEvents(100) : Promise.resolve([]),
  ]);

  return (
    <>
      <SecurityCard
        twoFactorEnabled={twoFactorEnabled}
        enforceTwoFactor={enforceTwoFactor}
        isAdmin={isAdmin}
      />
      {isAdmin && <AuditLogCard events={auditEvents} />}
    </>
  );
}

async function UserGroup({ currentUserId }: { currentUserId: string }) {
  const users = await listUsers();
  return <UserManagementCard users={users} currentUserId={currentUserId} />;
}

async function IntegrationsGroup({ isAdmin }: { isAdmin: boolean }) {
  const [apiTokens, ingestionKeys] = await Promise.all([
    listApiTokens(),
    isAdmin ? listIngestionKeys() : Promise.resolve([]),
  ]);
  return (
    <>
      <ApiTokenCard tokens={apiTokens} />
      {isAdmin && <IngestionKeyCard keys={ingestionKeys} />}
    </>
  );
}

async function DataGroup() {
  const [policy, snapshots, dbStats, logRetention] = await Promise.all([
    getBackupPolicy(),
    listSnapshots(),
    getDatabaseStats(),
    getLogRetentionPolicy(),
  ]);
  return (
    <>
      <SystemBackupCard />
      <BackupPolicyCard policy={policy} snapshots={snapshots} />
      <DatabaseMaintenanceCard stats={dbStats} logRetention={logRetention} />
    </>
  );
}

async function SystemGroup({ isAdmin }: { isAdmin: boolean }) {
  const [versionInfo, channel] = await Promise.all([getCurrentVersionInfo(), getUpdateChannel()]);
  return (
    <>
      <UpdateSettingsCard versionInfo={versionInfo} channel={channel} />
      {/* Directly below the update card on purpose: a rollback's progress is
          rendered by that card (one update state, one place that shows it), so
          the two belong within a glance of each other. */}
      {isAdmin && <VersionHistoryCard tokenRequired={updateTokenRequired()} />}
    </>
  );
}
