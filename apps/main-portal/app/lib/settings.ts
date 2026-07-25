import { prisma } from "@zaehlwerk/database";
import {
  DEFAULT_RELEASE_CHANNEL,
  toReleaseChannel,
  type ReleaseChannel,
} from "@zaehlwerk/updater";

// Typed access to the Setting key/value store. Keep the keys and their parsing
// here so callers deal in numbers/booleans, never raw strings. This module is
// plain server code (NOT a "use server" action file) so it can export
// constants and be imported by both the scheduler and the UI actions.

export const SETTING_KEYS = {
  backupRetentionDays: "backup.retentionDays",
  backupAutoEnabled: "backup.autoEnabled",
  backupIntervalHours: "backup.intervalHours",
  backupLastRunAt: "backup.lastRunAt",
  logRetentionDays: "logs.retentionDays",
  logMaxCount: "logs.maxCount",
  maintenanceLastRunAt: "maintenance.lastRunAt",
  updateChannel: "update.channel",
} as const;

export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_INTERVAL_HOURS = 24;

export type BackupPolicy = {
  retentionDays: number;
  autoEnabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
};

/**
 * Which release channel this instance follows. Stored, not env-configured: it is
 * a per-instance decision the admin makes in the UI, and it has to survive the
 * container being recreated by an update.
 */
export async function getUpdateChannel(): Promise<ReleaseChannel> {
  return toReleaseChannel(await readSetting(SETTING_KEYS.updateChannel));
}

export async function setUpdateChannel(channel: ReleaseChannel): Promise<void> {
  await writeSetting(SETTING_KEYS.updateChannel, channel);
}

export { DEFAULT_RELEASE_CHANNEL };
export type { ReleaseChannel };

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

// ---------------------------------------------------------------------------
// Log retention
// ---------------------------------------------------------------------------

/**
 * Retention policy for stored datalogs. The raw CSVs are by far the largest
 * thing this instance keeps, and nothing ever removed them automatically — on a
 * home server with a watch-folder importer that is an unbounded disk leak (a
 * full disk is the recurring failure mode here, see DEPLOYMENT.md).
 *
 * BOTH limits default to 0 = unlimited, i.e. retention is strictly opt-in.
 * Enabling it deletes real user data, so that has to be an admin's decision,
 * never a side effect of upgrading. When both are set the stricter one wins:
 * a log is removed if it is too old OR beyond the newest `maxCount`.
 */
export type LogRetentionPolicy = {
  /** Delete logs older than this many days. 0 = keep forever. */
  retentionDays: number;
  /** Keep only the newest N logs. 0 = no cap. */
  maxCount: number;
  /** ISO timestamp of the last automatic maintenance run, or null. */
  lastRunAt: string | null;
};

export async function getLogRetentionPolicy(): Promise<LogRetentionPolicy> {
  const [days, maxCount, lastRun] = await Promise.all([
    readSetting(SETTING_KEYS.logRetentionDays),
    readSetting(SETTING_KEYS.logMaxCount),
    readSetting(SETTING_KEYS.maintenanceLastRunAt),
  ]);

  return {
    retentionDays: Math.max(0, toInt(days, 0)),
    maxCount: Math.max(0, toInt(maxCount, 0)),
    lastRunAt: lastRun,
  };
}

export async function setLogRetentionPolicy(patch: {
  retentionDays?: number;
  maxCount?: number;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (patch.retentionDays !== undefined) {
    writes.push(writeSetting(SETTING_KEYS.logRetentionDays, String(Math.max(0, Math.trunc(patch.retentionDays)))));
  }
  if (patch.maxCount !== undefined) {
    writes.push(writeSetting(SETTING_KEYS.logMaxCount, String(Math.max(0, Math.trunc(patch.maxCount)))));
  }
  await Promise.all(writes);
}

export async function markMaintenanceRun(when: Date = new Date()): Promise<void> {
  await writeSetting(SETTING_KEYS.maintenanceLastRunAt, when.toISOString());
}
