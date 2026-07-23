import { prisma } from "@zaehlwerk/database";

// Typed access to the Setting key/value store. Keep the keys and their parsing
// here so callers deal in numbers/booleans, never raw strings. This module is
// plain server code (NOT a "use server" action file) so it can export
// constants and be imported by both the scheduler and the UI actions.

export const SETTING_KEYS = {
  backupRetentionDays: "backup.retentionDays",
  backupAutoEnabled: "backup.autoEnabled",
  backupIntervalHours: "backup.intervalHours",
  backupLastRunAt: "backup.lastRunAt",
} as const;

export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_INTERVAL_HOURS = 24;

export type BackupPolicy = {
  retentionDays: number;
  autoEnabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
};

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

function toInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Current backup policy, with sane defaults when nothing has been configured. */
export async function getBackupPolicy(): Promise<BackupPolicy> {
  const [retention, auto, interval, lastRun] = await Promise.all([
    readSetting(SETTING_KEYS.backupRetentionDays),
    readSetting(SETTING_KEYS.backupAutoEnabled),
    readSetting(SETTING_KEYS.backupIntervalHours),
    readSetting(SETTING_KEYS.backupLastRunAt),
  ]);

  return {
    retentionDays: Math.max(0, toInt(retention, DEFAULT_RETENTION_DAYS)),
    autoEnabled: auto === "true",
    intervalHours: Math.max(1, toInt(interval, DEFAULT_INTERVAL_HOURS)),
    lastRunAt: lastRun,
  };
}

export async function setBackupPolicy(patch: {
  retentionDays?: number;
  autoEnabled?: boolean;
  intervalHours?: number;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (patch.retentionDays !== undefined) {
    writes.push(writeSetting(SETTING_KEYS.backupRetentionDays, String(Math.max(0, Math.trunc(patch.retentionDays)))));
  }
  if (patch.autoEnabled !== undefined) {
    writes.push(writeSetting(SETTING_KEYS.backupAutoEnabled, patch.autoEnabled ? "true" : "false"));
  }
  if (patch.intervalHours !== undefined) {
    writes.push(writeSetting(SETTING_KEYS.backupIntervalHours, String(Math.max(1, Math.trunc(patch.intervalHours)))));
  }
  await Promise.all(writes);
}

export async function markBackupRun(when: Date = new Date()): Promise<void> {
  await writeSetting(SETTING_KEYS.backupLastRunAt, when.toISOString());
}
