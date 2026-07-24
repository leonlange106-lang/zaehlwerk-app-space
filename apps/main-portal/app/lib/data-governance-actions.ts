"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth-helpers";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { createSnapshot, deleteSnapshot, pruneSnapshots } from "./backup-engine";
import { optimizeDatabase, vacuumDatabase } from "./db-maintenance";
import { runMaintenance } from "./maintenance";
import {
  getBackupPolicy,
  getLogRetentionPolicy,
  markBackupRun,
  setBackupPolicy,
  setLogRetentionPolicy,
} from "./settings";

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
    revalidatePath("/settings");
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
  revalidatePath("/settings");
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
  revalidatePath("/settings");
  return { success: true, message: "Backup-Richtlinie gespeichert." };
}

export async function runVacuum(): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  try {
    const { freedBytes } = await vacuumDatabase();
    await recordAuditEvent(AUDIT_ACTIONS.dbVacuum, admin.email, `${freedBytes} Bytes freigegeben`);
    revalidatePath("/settings");
    const freed = freedBytes > 0 ? ` ${formatBytes(freedBytes)} freigegeben.` : "";
    return { success: true, message: `VACUUM abgeschlossen.${freed}` };
  } catch (error) {
    console.error("[runVacuum]", error);
    return { success: false, message: "VACUUM fehlgeschlagen (Details im Server-Log)." };
  }
}

/** Apply the log retention policy now, then reclaim the freed space. */
export async function runLogMaintenance(): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  try {
    const report = await runMaintenance();
    if (!report.retentionEnabled) {
      return {
        success: false,
        message: "Keine Aufbewahrungsgrenze gesetzt — es wurde nichts gelöscht.",
      };
    }
    if (report.prunedLogs === 0) {
      return { success: true, message: "Aufräumen abgeschlossen — kein Log war zu alt." };
    }

    await recordAuditEvent(
      AUDIT_ACTIONS.logPrune,
      admin.email,
      `${report.prunedLogs} Log(s) gelöscht, ${report.freedBytes} Bytes freigegeben`,
    );
    revalidatePath("/settings");
    const freed = report.freedBytes > 0 ? ` ${formatBytes(report.freedBytes)} freigegeben.` : "";
    return {
      success: true,
      message: `${report.prunedLogs} Log(s) gelöscht.${freed}`,
    };
  } catch (error) {
    console.error("[runLogMaintenance]", error);
    return { success: false, message: "Aufräumen fehlgeschlagen (Details im Server-Log)." };
  }
}

export async function updateLogRetentionPolicy(patch: {
  retentionDays?: number;
  maxCount?: number;
}): Promise<GovernanceResult> {
  const admin = await requireAdmin();
  await setLogRetentionPolicy(patch);
  const policy = await getLogRetentionPolicy();
  await recordAuditEvent(
    AUDIT_ACTIONS.logRetentionPolicy,
    admin.email,
    `${policy.retentionDays === 0 ? "unbegrenzte" : policy.retentionDays + "-Tage-"}Aufbewahrung, ` +
      `${policy.maxCount === 0 ? "kein Limit" : "max. " + policy.maxCount + " Logs"}`,
  );
  revalidatePath("/settings");
  return { success: true, message: "Log-Aufbewahrung gespeichert." };
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
