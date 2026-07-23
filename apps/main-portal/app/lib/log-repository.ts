import { prisma } from "@zaehlwerk/database";
import { parseLog } from "../apps/log-analyzer/lib/log-parser";
import { evaluateLogPull } from "../apps/log-analyzer/lib/evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC } from "../apps/log-analyzer/lib/vehicle-spec";
import type { PullStatus } from "../apps/log-analyzer/lib/evaluate-log-pull";

// Server-side persistence for uploaded MGflasher datalogs. Logs used to live
// only in the browser (localStorage); they now survive server-side so they
// persist across devices/sessions, carry the automatically-evaluated pull
// status, and can be tagged (real octane driven, free tags). The raw CSV is
// stored verbatim and re-parsed on open — compact and lossless.

export type { PullStatus };

export interface LogUploadInput {
  name: string;
  csv: string;
  source?: "upload" | "remote";
  sourceUrl?: string | null;
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
} {
  try {
    const log = parseLog(csv);
    const status =
      log.rowCount === 0 ? "invalid" : evaluateLogPull(log, DEFAULT_VEHICLE_SPEC).validity.status;
    return {
      rowCount: log.rowCount,
      vin: log.meta.vin,
      vehicle: log.meta.vehicle,
      mapVersion: log.meta.mapVersion,
      software: log.meta.software,
      loggedAt: log.meta.date,
      status,
    };
  } catch {
    return { rowCount: 0, vin: null, vehicle: null, mapVersion: null, software: null, loggedAt: null, status: "invalid" };
  }
}

type LogRow = {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  rowCount: number;
  vin: string | null;
  vehicle: string | null;
  status: string;
  octane: string | null;
  tags: string;
  createdAt: Date;
};

function toSummary(row: LogRow): LogSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    sourceUrl: row.sourceUrl,
    rowCount: row.rowCount,
    vin: row.vin,
    vehicle: row.vehicle,
    status: row.status as PullStatus,
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
    const row = await prisma.logFile.create({
      data: {
        name: input.name,
        source: input.source ?? "upload",
        sourceUrl: input.sourceUrl ?? null,
        csv: input.csv,
        rowCount: d.rowCount,
        vin: d.vin,
        vehicle: d.vehicle,
        mapVersion: d.mapVersion,
        software: d.software,
        loggedAt: d.loggedAt,
        status: d.status,
      },
    });
    created.push(toSummary(row));
  }
  return created;
}

/** All stored logs as summaries, newest first. */
export async function listLogs(): Promise<LogSummary[]> {
  const rows = await prisma.logFile.findMany({ orderBy: { createdAt: "desc" } });
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
