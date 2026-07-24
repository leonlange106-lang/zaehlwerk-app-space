import { prisma } from "@zaehlwerk/database";
import { parseLog } from "../apps/log-analyzer/lib/log-parser";
import { evaluateLogPull, healthFromAlerts } from "../apps/log-analyzer/lib/evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC } from "../apps/log-analyzer/lib/vehicle-spec";
import { parseLogFilename } from "../apps/log-analyzer/lib/log-filename";
import type { PullHealth, PullStatus } from "../apps/log-analyzer/lib/evaluate-log-pull";

// Server-side persistence for uploaded MGflasher datalogs. Logs used to live
// only in the browser (localStorage); they now survive server-side so they
// persist across devices/sessions, carry the automatically-evaluated pull
// status + hardware-health, the drive time parsed from the filename (for
// chronological sorting), and can be tagged (real octane driven, free tags).
// The raw CSV is stored verbatim and re-parsed on open — compact and lossless.
//
// Pull-status and hardware-health are NOT frozen at import: because the raw CSV
// is kept, they are re-evaluated LIVE against the current thresholds every time a
// log is read (list/get). So when the safety limits or evaluation logic change,
// every already-uploaded log's "Hardware-Risiko" / "Beobachten" badge updates
// automatically — no re-import needed. The persisted columns are only a cache /
// fallback for when a stored CSV can no longer be parsed.

export type { PullStatus, PullHealth };

/** How a log entered the system. "ingest"/"watch" are the automated paths. */
export type LogSource = "upload" | "remote" | "ingest" | "watch";

export interface LogUploadInput {
  name: string;
  csv: string;
  source?: LogSource;
  sourceUrl?: string | null;
  /** SHA-256 (hex) of the raw CSV — persisted for dedup of automated imports. */
  contentHash?: string | null;
  /** Free-text note (e.g. from an ingestion request). */
  notes?: string | null;
  /** Explicit vehicle override; when absent the value parsed from the CSV wins. */
  vehicle?: string | null;
}

/** Row shown in the log overview (no bulky CSV). */
export interface LogSummary {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  rowCount: number;
  vin: string | null;
  vehicle: string | null;
  status: PullStatus;
  health: PullHealth;
  notes: string | null;
  /** Drive time parsed from the filename (ISO), or null. */
  recordedAt: string | null;
  octane: string | null;
  tags: string[];
  createdAt: string;
}

/** Full record including the raw CSV (for re-parsing in the analyzer). */
export interface LogRecord extends LogSummary {
  csv: string;
  mapVersion: string | null;
  software: string | null;
  loggedAt: string | null;
}

function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Parse + evaluate a CSV, returning the derived columns we persist. */
function derive(csv: string): {
  rowCount: number;
  vin: string | null;
  vehicle: string | null;
  mapVersion: string | null;
  software: string | null;
  loggedAt: string | null;
  status: PullStatus;
  health: PullHealth;
} {
  try {
    const log = parseLog(csv);
    if (log.rowCount === 0) {
      return { rowCount: 0, vin: null, vehicle: null, mapVersion: null, software: null, loggedAt: null, status: "invalid", health: "safe" };
    }
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    return {
      rowCount: log.rowCount,
      vin: log.meta.vin,
      vehicle: log.meta.vehicle,
      mapVersion: log.meta.mapVersion,
      software: log.meta.software,
      loggedAt: log.meta.date,
      status: evaluation.validity.status,
      health: healthFromAlerts(evaluation.alerts),
    };
  } catch {
    return { rowCount: 0, vin: null, vehicle: null, mapVersion: null, software: null, loggedAt: null, status: "invalid", health: "safe" };
  }
}

type LogRow = {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  csv: string;
  rowCount: number;
  vin: string | null;
  vehicle: string | null;
  status: string;
  health: string;
  notes: string | null;
  recordedAt: Date | null;
  octane: string | null;
  tags: string;
  createdAt: Date;
};

/**
 * Re-evaluate a stored log's pull-status + hardware-health against the CURRENT
 * thresholds from its raw CSV. This is what keeps the overview badges live: a
 * threshold change re-scores every existing log on the next read. Falls back to
 * the persisted columns when the CSV can't be re-parsed (empty / corrupt).
 */
function liveVerdict(row: LogRow): { status: PullStatus; health: PullHealth } {
  if (row.csv) {
    try {
      const log = parseLog(row.csv);
      if (log.rowCount > 0) {
        const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
        return {
          status: evaluation.validity.status,
          health: healthFromAlerts(evaluation.alerts),
        };
      }
    } catch {
      // fall through to the persisted values
    }
  }
  return { status: row.status as PullStatus, health: row.health as PullHealth };
}

function toSummary(row: LogRow): LogSummary {
  const { status, health } = liveVerdict(row);
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    sourceUrl: row.sourceUrl,
    rowCount: row.rowCount,
    vin: row.vin,
    vehicle: row.vehicle,
    status,
    health,
    notes: row.notes,
    recordedAt: row.recordedAt ? row.recordedAt.toISOString() : null,
    octane: row.octane,
    tags: splitTags(row.tags),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Persist one or many uploaded logs (bulk upload). Returns their summaries. */
export async function createLogs(inputs: LogUploadInput[]): Promise<LogSummary[]> {
  const created: LogSummary[] = [];
  for (const input of inputs) {
    const d = derive(input.csv);
    const fromName = parseLogFilename(input.name);
    const row = await prisma.logFile.create({
      data: {
        name: input.name,
        source: input.source ?? "upload",
        sourceUrl: input.sourceUrl ?? null,
        csv: input.csv,
        rowCount: d.rowCount,
        vin: d.vin,
        // An explicit vehicle override wins over the value parsed from the CSV.
        vehicle: input.vehicle ?? d.vehicle,
        mapVersion: d.mapVersion,
        software: d.software,
        loggedAt: d.loggedAt,
        status: d.status,
        health: d.health,
        contentHash: input.contentHash ?? null,
        notes: input.notes ?? null,
        // Drive time & octane pre-filled from the filename when present.
        recordedAt: fromName.recordedAt,
        octane: fromName.octane,
      },
    });
    created.push(toSummary(row));
  }
  return created;
}

/**
 * Find an already-stored log by its raw-CSV SHA-256 hash — the dedup check for
 * automated ingestion (API / watch-folder), so the same file dropped twice is
 * only imported once. Returns the existing summary, or null when unseen.
 */
export async function findLogByContentHash(contentHash: string): Promise<LogSummary | null> {
  const row = await prisma.logFile.findFirst({
    where: { contentHash },
    orderBy: { createdAt: "desc" },
  });
  return row ? toSummary(row) : null;
}

/** All stored logs as summaries, chronologically by drive time (newest first). */
export async function listLogs(): Promise<LogSummary[]> {
  const rows = await prisma.logFile.findMany({
    orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return rows.map(toSummary);
}

/** One full log record (incl. CSV), or null. */
export async function getLog(id: string): Promise<LogRecord | null> {
  const row = await prisma.logFile.findUnique({ where: { id } });
  if (!row) return null;
  return {
    ...toSummary(row),
    csv: row.csv,
    mapVersion: row.mapVersion,
    software: row.software,
    loggedAt: row.loggedAt,
  };
}

/** Update the user tags (octane + free tags) on a log. */
export async function updateLogTags(
  id: string,
  patch: { octane?: string | null; tags?: string[] },
): Promise<LogSummary | null> {
  const data: { octane?: string | null; tags?: string } = {};
  if (patch.octane !== undefined) data.octane = patch.octane?.trim() || null;
  if (patch.tags !== undefined) {
    data.tags = patch.tags.map((t) => t.trim()).filter(Boolean).join(", ");
  }
  try {
    const row = await prisma.logFile.update({ where: { id }, data });
    return toSummary(row);
  } catch {
    return null;
  }
}

/** Delete a stored log. */
export async function deleteLog(id: string): Promise<boolean> {
  try {
    await prisma.logFile.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
