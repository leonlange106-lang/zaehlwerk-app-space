import { prisma } from "@zaehlwerk/database";
import { parseLog } from "../apps/log-analyzer/lib/log-parser";
import { evaluateLogPull, healthFromAlerts } from "../apps/log-analyzer/lib/evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC } from "../apps/log-analyzer/lib/vehicle-spec";
import { parseLogFilename } from "../apps/log-analyzer/lib/log-filename";
import { EVALUATION_VERSION } from "../apps/log-analyzer/lib/evaluation-version";
import type { PullHealth, PullStatus } from "../apps/log-analyzer/lib/evaluate-log-pull";

// Server-side persistence for uploaded MGflasher datalogs. Logs used to live
// only in the browser (localStorage); they now survive server-side so they
// persist across devices/sessions, carry the automatically-evaluated pull
// status + hardware-health, the drive time parsed from the filename (for
// chronological sorting), and can be tagged (real octane driven, free tags).
// The raw CSV is stored verbatim and re-parsed on open — compact and lossless.
//
// Pull-status and hardware-health are NOT frozen at import: because the raw CSV
// is kept, a log is re-evaluated against the current thresholds whenever those
// thresholds (or the evaluation logic) have changed since it was last scored. So
// when the safety limits change, every already-uploaded log's "Hardware-Risiko"
// / "Beobachten" badge updates automatically — no re-import needed.
//
// That re-scoring is driven by `EVALUATION_VERSION` rather than by re-parsing on
// every read. Each row stores the fingerprint it was last scored with; a row
// that still matches is served straight from its cached columns, so listing the
// overview never loads a single CSV. Only rows left stale by a threshold/logic
// change pay for a re-parse, once, and are written back. This matters because
// the CSVs are by far the largest column in the database — the old
// "re-parse everything on every list" path read the whole log corpus into memory
// on each visit to the overview.

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

/** Every summary column — deliberately WITHOUT the bulky `csv`. */
const SUMMARY_SELECT = {
  id: true,
  name: true,
  source: true,
  sourceUrl: true,
  rowCount: true,
  vin: true,
  vehicle: true,
  status: true,
  health: true,
  notes: true,
  recordedAt: true,
  octane: true,
  tags: true,
  createdAt: true,
  evalVersion: true,
} as const;

type SummaryRow = {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
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
  evalVersion?: string | null;
};

type Verdict = { status: PullStatus; health: PullHealth };

/**
 * Score a raw CSV against the CURRENT thresholds, or null when it can't be
 * parsed (empty / corrupt) — in which case the caller keeps what was persisted.
 */
function verdictFromCsv(csv: string): Verdict | null {
  if (!csv) return null;
  try {
    const log = parseLog(csv);
    if (log.rowCount === 0) return null;
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    return {
      status: evaluation.validity.status,
      health: healthFromAlerts(evaluation.alerts),
    };
  } catch {
    return null;
  }
}

/**
 * Bring rows scored under an older {@link EVALUATION_VERSION} up to date, in
 * place, and write the fresh verdict back so the work happens only once per
 * threshold change. Rows already on the current version are untouched — which is
 * the whole point: the common case never reads a CSV.
 *
 * Best-effort throughout. If the re-scoring write fails we still return the
 * freshly computed verdict; the row simply stays stale and is retried next read.
 */
async function refreshStaleVerdicts(rows: SummaryRow[]): Promise<void> {
  const stale = rows.filter((row) => row.evalVersion !== EVALUATION_VERSION);
  if (stale.length === 0) return;

  const staleById = new Map(stale.map((row) => [row.id, row]));
  const withCsv = await prisma.logFile.findMany({
    where: { id: { in: [...staleById.keys()] } },
    select: { id: true, csv: true },
  });

  await Promise.all(
    withCsv.map(async ({ id, csv }) => {
      const row = staleById.get(id);
      if (!row) return;
      const verdict = verdictFromCsv(csv);
      if (verdict) {
        row.status = verdict.status;
        row.health = verdict.health;
      }
      row.evalVersion = EVALUATION_VERSION;
      try {
        await prisma.logFile.update({
          where: { id },
          data: { status: row.status, health: row.health, evalVersion: EVALUATION_VERSION },
        });
      } catch {
        // Re-scoring is a cache refresh, never the caller's problem.
      }
    }),
  );
}

function toSummary(row: SummaryRow): LogSummary {
  const status = row.status as PullStatus;
  const health = row.health as PullHealth;
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
        // Freshly scored, so it is already on the current evaluation version.
        evalVersion: EVALUATION_VERSION,
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
  // Dedup only needs to know THAT the file exists, so skip the CSV entirely —
  // this runs on every automated import (API + watch-folder).
  const row = await prisma.logFile.findFirst({
    where: { contentHash },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
  if (!row) return null;
  await refreshStaleVerdicts([row]);
  return toSummary(row);
}

/** All stored logs as summaries, chronologically by drive time (newest first). */
export async function listLogs(): Promise<LogSummary[]> {
  const rows = await prisma.logFile.findMany({
    orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: SUMMARY_SELECT,
  });
  await refreshStaleVerdicts(rows);
  return rows.map(toSummary);
}

/** One full log record (incl. CSV), or null. */
export async function getLog(id: string): Promise<LogRecord | null> {
  const row = await prisma.logFile.findUnique({ where: { id } });
  if (!row) return null;

  // The CSV is already in hand here, so re-score directly rather than making
  // refreshStaleVerdicts fetch it a second time.
  if (row.evalVersion !== EVALUATION_VERSION) {
    const verdict = verdictFromCsv(row.csv);
    if (verdict) {
      row.status = verdict.status;
      row.health = verdict.health;
    }
    try {
      await prisma.logFile.update({
        where: { id },
        data: { status: row.status, health: row.health, evalVersion: EVALUATION_VERSION },
      });
    } catch {
      // cache refresh only — never fail the read
    }
  }

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
    // Tags don't affect the verdict, so the cached status/health carry over —
    // and the CSV stays out of the response.
    const row = await prisma.logFile.update({ where: { id }, data, select: SUMMARY_SELECT });
    return toSummary(row);
  } catch {
    return null;
  }
}

/**
 * Apply a retention policy to the stored logs and return how many were deleted.
 *
 * Two independent limits, either of which may be disabled with 0:
 *   `retentionDays` — drop anything older than the cutoff,
 *   `maxCount`      — keep only the newest N.
 *
 * "Newest" is the same ordering the overview uses (drive time, falling back to
 * upload time), so the cap keeps exactly the logs a user sees at the top of the
 * list. With both limits off this is a no-op and does not touch the database.
 */
export async function pruneLogs(policy: {
  retentionDays: number;
  maxCount: number;
}): Promise<{ deleted: number }> {
  const retentionDays = Math.max(0, Math.trunc(policy.retentionDays));
  const maxCount = Math.max(0, Math.trunc(policy.maxCount));
  if (retentionDays === 0 && maxCount === 0) return { deleted: 0 };

  let deleted = 0;

  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.logFile.deleteMany({ where: { createdAt: { lt: cutoff } } });
    deleted += result.count;
  }

  if (maxCount > 0) {
    // Ask only for the ids beyond the cap — never the CSVs.
    const overflow = await prisma.logFile.findMany({
      orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: maxCount,
      select: { id: true },
    });
    if (overflow.length > 0) {
      const result = await prisma.logFile.deleteMany({
        where: { id: { in: overflow.map((row) => row.id) } },
      });
      deleted += result.count;
    }
  }

  return { deleted };
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
