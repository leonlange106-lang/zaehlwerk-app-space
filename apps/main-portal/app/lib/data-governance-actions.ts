"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth-helpers";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { createSnapshot, deleteSnapshot, pruneSnapshots } from "./backup-engine";
import { optimizeDatabase, vacuumDatabase } from "./db-maintenance";
import { getBackupPolicy, markBackupRun, setBackupPolicy } from "./settings";

export type GovernanceResult = { success: boolean; message: string };

/** Create a snapshot now and immediately apply the retention policy. */
export async function createBackupNow(): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  try {
    const result = await createSnapshot();
    await markBackupRun();
    const policy = await getBackupPolicy();
    const pruned = await pruneSnapshots(policy.retentionDays);

    await recordAuditEvent(
      AUDIT_ACTIONS.backupCreate,
      admin.email,
      `${result.jsonName}${result.sqliteName ? ` + ${result.sqliteName}` : ""}` +
        (pruned > 0 ? ` (${pruned} alte gelöscht)` : ""),
    );
    revalidatePath("/einstellungen");
    const suffix = pruned > 0 ? ` ${pruned} veraltete Sicherung(en) entfernt.` : "";
    return { success: true, message: `Backup erstellt: ${result.jsonName}.${suffix}` };
  } catch (error) {
    console.error("[createBackupNow]", error);
    return { success: false, message: "Das Backup konnte nicht erstellt werden (Details im Server-Log)." };
  }
}

export async function deleteBackup(name: string): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  const ok = await deleteSnapshot(name);
  if (!ok) return { success: false, message: "Die Sicherung konnte nicht gelöscht werden." };
  await recordAuditEvent(AUDIT_ACTIONS.backupDelete, admin.email, name);
  revalidatePath("/einstellungen");
  return { success: true, message: "Sicherung gelöscht." };
}

export async function updateBackupPolicy(patch: {
  retentionDays?: number;
  autoEnabled?: boolean;
  intervalHours?: number;
}): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  await setBackupPolicy(patch);
  const policy = await getBackupPolicy();
  await recordAuditEvent(
    AUDIT_ACTIONS.backupPolicy,
    admin.email,
    `Auto ${policy.autoEnabled ? "an" : "aus"}, alle ${policy.intervalHours}h, ` +
      `${policy.retentionDays === 0 ? "unbegrenzte" : policy.retentionDays + "-Tage-"}Aufbewahrung`,
  );
  revalidatePath("/einstellungen");
  return { success: true, message: "Backup-Richtlinie gespeichert." };
}

export async function runVacuum(): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  try {
    const { freedBytes } = await vacuumDatabase();
    await recordAuditEvent(AUDIT_ACTIONS.dbVacuum, admin.email, `${freedBytes} Bytes freigegeben`);
    revalidatePath("/einstellungen");
    const freed = freedBytes > 0 ? ` ${formatBytes(freedBytes)} freigegeben.` : "";
    return { success: true, message: `VACUUM abgeschlossen.${freed}` };
  } catch (error) {
    console.error("[runVacuum]", error);
    return { success: false, message: "VACUUM fehlgeschlagen (Details im Server-Log)." };
  }
}

export async function runOptimize(): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  try {
    await optimizeDatabase();
    await recordAuditEvent(AUDIT_ACTIONS.dbOptimize, admin.email);
    return { success: true, message: "PRAGMA optimize abgeschlossen." };
  } catch (error) {
    console.error("[runOptimize]", error);
    return { success: false, message: "PRAGMA optimize fehlgeschlagen (Details im Server-Log)." };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
