import { sha256Hex } from "./crypto";
import { broadcastLogIngested } from "./log-events";
import { ingestStatusFromPull, type IngestStatus } from "./log-ingest-status";
import {
  createLogs,
  findLogByContentHash,
  type LogSource,
  type LogSummary,
} from "./log-repository";

// Single orchestration entry point for automated log ingestion, shared by the
// ingestion API route AND the watch-folder service so both behave identically:
//
//   1. hash the raw CSV (SHA-256) for deduplication,
//   2. short-circuit when that exact content was already stored (idempotent),
//   3. otherwise parse + evaluate + persist via the existing repository,
//   4. broadcast a realtime event so connected clients refresh.
//
// Pure of any HTTP/filesystem concern — callers pass the CSV text in.

export interface IngestParams {
  /** File name (used for display + drive-time/octane parsing from the name). */
  name: string;
  /** Raw CSV content. */
  csv: string;
  /** Entry path: "ingest" (API) or "watch" (watch-folder). */
  source: LogSource;
  /** Optional vehicle override (else parsed from the CSV header). */
  vehicle?: string | null;
  /** Optional free-text note. */
  notes?: string | null;
  /** Optional logging-profile id; folded into the stored note as context. */
  profileId?: string | null;
}

export interface IngestResult {
  /** True when the CSV was already stored (not re-imported). */
  duplicate: boolean;
  log: LogSummary;
  /** UPPER-CASE status for the API response / external consumers. */
  ingestStatus: IngestStatus;
}

/** Combine an optional profileId into the free-text note without losing either. */
function composeNotes(notes?: string | null, profileId?: string | null): string | null {
  const parts: string[] = [];
  if (profileId && profileId.trim()) parts.push(`profileId=${profileId.trim()}`);
  if (notes && notes.trim()) parts.push(notes.trim());
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Ingest a single CSV log. Deduplicates by content hash, persists new logs, and
 * broadcasts a realtime event (for both new imports AND rediscovered duplicates,
 * so a client still learns the file was seen). Returns the resulting summary and
 * the UPPER-CASE ingestion status.
 */
export async function ingestCsv(params: IngestParams): Promise<IngestResult> {
  const contentHash = sha256Hex(params.csv);

  const existing = await findLogByContentHash(contentHash);
  if (existing) {
    const result: IngestResult = {
      duplicate: true,
      log: existing,
      ingestStatus: ingestStatusFromPull(existing.status),
    };
    emit(result, params.source);
    return result;
  }

  const [log] = await createLogs([
    {
      name: params.name,
      csv: params.csv,
      source: params.source,
      contentHash,
      notes: composeNotes(params.notes, params.profileId),
      vehicle: params.vehicle ?? undefined,
    },
  ]);

  const result: IngestResult = {
    duplicate: false,
    log,
    ingestStatus: ingestStatusFromPull(log.status),
  };
  emit(result, params.source);
  return result;
}

function emit(result: IngestResult, source: string): void {
  broadcastLogIngested({
    type: "ingested",
    id: result.log.id,
    name: result.log.name,
    status: result.log.status,
    ingestStatus: result.ingestStatus,
    health: result.log.health,
    source,
    duplicate: result.duplicate,
    at: new Date().toISOString(),
  });
}
