import { prisma } from "@zaehlwerk/database";
import { parseLog } from "../apps/log-analyzer/lib/log-parser";
import { evaluateLogPull, healthFromAlerts } from "../apps/log-analyzer/lib/evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "../apps/log-analyzer/lib/vehicle-spec";
import { parseLogFilename } from "../apps/log-analyzer/lib/log-filename";
import { evaluationVersionFor } from "../apps/log-analyzer/lib/evaluation-version";
import { effectiveLimits, type LimitOverrides } from "../apps/log-analyzer/lib/limit-overrides";
import { getActiveVehicle, getVehicle, type StoredVehicle } from "./vehicle-repository";
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
  /** Free-text name the user gave this log, or null if never named. */
  label: string | null;
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

/**
 * What a log is judged by: the vehicle's spec and its own limit patch, plus the
 * cache fingerprint those two produce.
 *
 * A log with no vehicle keeps the default spec and an empty patch. That case is
 * not merely similar to the old behaviour, it is byte-identical: the version
 * string is a hash over the effective limits, and `effectiveLimits(DEFAULT, {})`
 * is `limitsForSpec(DEFAULT)` — the value the old constant hashed. So wiring
 * vehicles up does NOT invalidate a single already-scored row.
 */
interface Scoring {
  spec: VehicleSpec;
  overrides: LimitOverrides;
  version: string;
}

function scoringFor(vehicle: StoredVehicle | null): Scoring {
  const spec = vehicle?.spec ?? DEFAULT_VEHICLE_SPEC;
  const overrides = vehicle?.limitOverrides ?? {};
  return { spec, overrides, version: evaluationVersionFor(effectiveLimits(spec, overrides)) };
}

/** Parse + evaluate a CSV, returning the derived columns we persist. */
function derive(csv: string, scoring: Scoring): {
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
    const evaluation = evaluateLogPull(log, scoring.spec, scoring.overrides);
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
  label: true,
  octane: true,
  tags: true,
  createdAt: true,
  evalVersion: true,
  // Which vehicle this row was scored against — needed to know what its
  // fingerprint SHOULD be. Without it the staleness check can only compare
  // against the default and would leave every vehicle-scored row permanently
  // stale (or, worse, permanently trusted).
  vehicleId: true,
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
  label: string | null;
  octane: string | null;
  tags: string;
  createdAt: Date;
  evalVersion?: string | null;
  vehicleId?: string | null;
};

type Verdict = { status: PullStatus; health: PullHealth };

/**
 * Score a raw CSV against the CURRENT thresholds, or null when it can't be
 * parsed (empty / corrupt) — in which case the caller keeps what was persisted.
 */
function verdictFromCsv(csv: string, scoring: Scoring): Verdict | null {
  if (!csv) return null;
  try {
    const log = parseLog(csv);
    if (log.rowCount === 0) return null;
    const evaluation = evaluateLogPull(log, scoring.spec, scoring.overrides);
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
  // The expected fingerprint is now per ROW, not global: two logs on different
  // vehicles legitimately carry different versions. So resolve each row's
  // vehicle first, then compare — one query for the distinct ids, not one per
  // row.
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleId).filter((id): id is string => !!id))];
  const vehicles = new Map<string, StoredVehicle>();
  await Promise.all(
    vehicleIds.map(async (id) => {
      const vehicle = await getVehicle(id);
      if (vehicle) vehicles.set(id, vehicle);
    }),
  );
  // A vehicle that has since been deleted falls back to the default scoring —
  // the same treatment as a log that never had one.
  const scoringOf = (row: SummaryRow) => scoringFor(row.vehicleId ? vehicles.get(row.vehicleId) ?? null : null);

  const stale = rows.filter((row) => row.evalVersion !== scoringOf(row).version);
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
      const scoring = scoringOf(row);
      const verdict = verdictFromCsv(csv, scoring);
      if (verdict) {
        row.status = verdict.status;
        row.health = verdict.health;
      }
      row.evalVersion = scoring.version;
      try {
        await prisma.logFile.update({
          where: { id },
          data: { status: row.status, health: row.health, evalVersion: scoring.version },
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
    label: row.label,
    octane: row.octane,
    tags: splitTags(row.tags),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Persist one or many uploaded logs (bulk upload). Returns their summaries. */
export async function createLogs(inputs: LogUploadInput[]): Promise<LogSummary[]> {
  const created: LogSummary[] = [];
  // Resolved ONCE for the whole batch, and pinned onto every row: the log
  // records which vehicle judged it, so a later change of the active vehicle
  // cannot silently re-interpret logs that were scored under the old one.
  const vehicle = await getActiveVehicle();
  const scoring = scoringFor(vehicle);
  for (const input of inputs) {
    const d = derive(input.csv, scoring);
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
        // Freshly scored, so it is already on the current evaluation version —
        // the one for THIS vehicle's effective limits.
        evalVersion: scoring.version,
        vehicleId: vehicle?.id ?? null,
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
/**
 * Obergrenze einer Seite.
 *
 * Nicht die uebliche 20 oder 50: Die Oberflaeche des Log Analyzers zeigt die
 * Liste am Stueck und filtert im Browser. Eine kleine Seitengroesse haette
 * bedeutet, gleichzeitig eine Blaetterlogik in die Oberflaeche zu bauen — das
 * ist ein eigenes Vorhaben. 200 deckt jeden heutigen Bestand ab und zieht
 * zugleich die Grenze, die vorher ganz fehlte.
 */
const LOGS_PAGE_SIZE = 200;
const LOGS_MAX_PAGE_SIZE = 500;

export interface ListLogsOptions {
  /** Hoechstzahl der Zeilen. Standard `LOGS_PAGE_SIZE`, Deckel `LOGS_MAX_PAGE_SIZE`. */
  limit?: number;
  /** Zeilen, die uebersprungen werden. */
  offset?: number;
}

export interface ListLogsResult {
  logs: LogSummary[];
  /** Gesamtzahl im Bestand — der Aufrufer soll wissen, was er NICHT sieht. */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Die Logliste, seitenweise.
 *
 * Vorher holte diese Abfrage JEDE Zeile — und `refreshStaleVerdicts` bewertete
 * anschliessend jede davon neu, samt CSV. Bei ein paar Dutzend Logs faellt das
 * nicht auf; bei ein paar Tausend ist es eine Anfrage, die den Server fuer
 * Sekunden beschaeftigt und dabei jedes CSV durch den Speicher zieht. Die
 * Grenze fehlte schlicht.
 *
 * `total` kommt mit: Eine abgeschnittene Liste ohne Angabe, wie viel fehlt,
 * sieht aus wie der ganze Bestand.
 */
export async function listLogs(options: ListLogsOptions = {}): Promise<ListLogsResult> {
  const limit = Math.min(Math.max(options.limit ?? LOGS_PAGE_SIZE, 1), LOGS_MAX_PAGE_SIZE);
  const offset = Math.max(options.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    prisma.logFile.findMany({
      orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: SUMMARY_SELECT,
      take: limit,
      skip: offset,
    }),
    prisma.logFile.count(),
  ]);

  // Nur die Zeilen DIESER Seite neu bewerten. Genau hier lag der Aufwand: Die
  // Neubewertung liest je Zeile das CSV.
  await refreshStaleVerdicts(rows);

  return {
    logs: rows.map(toSummary),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

/** One full log record (incl. CSV), or null. */
export async function getLog(id: string): Promise<LogRecord | null> {
  const row = await prisma.logFile.findUnique({ where: { id } });
  if (!row) return null;

  // The CSV is already in hand here, so re-score directly rather than making
  // refreshStaleVerdicts fetch it a second time. Judged by the vehicle this log
  // is pinned to — a deleted one falls back to the default, as above.
  const scoring = scoringFor(row.vehicleId ? await getVehicle(row.vehicleId) : null);
  if (row.evalVersion !== scoring.version) {
    const verdict = verdictFromCsv(row.csv, scoring);
    if (verdict) {
      row.status = verdict.status;
      row.health = verdict.health;
    }
    try {
      await prisma.logFile.update({
        where: { id },
        data: { status: row.status, health: row.health, evalVersion: scoring.version },
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

/** Update the user-editable metadata (name, octane, free tags) on a log. */
export async function updateLogTags(
  id: string,
  patch: { label?: string | null; octane?: string | null; tags?: string[] },
): Promise<LogSummary | null> {
  const data: { label?: string | null; octane?: string | null; tags?: string } = {};
  // An emptied field clears the name rather than storing "", so "has a name" stays
  // a single NULL check — that is what the navigation menu filters on.
  if (patch.label !== undefined) data.label = patch.label?.trim() || null;
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
