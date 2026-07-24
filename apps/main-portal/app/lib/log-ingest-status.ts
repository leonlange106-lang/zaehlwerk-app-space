import type { PullStatus } from "../apps/log-analyzer/lib/evaluate-log-pull";

// The ingestion API speaks a stable, UPPER-CASE status vocabulary to external
// consumers (Home Assistant, sync scripts): VERIFIED | WARNING | UNVERIFIED.
// Internally the analyzer uses verified | partial | invalid; this is the single
// mapping between the two, shared by the API route, the watcher and the SSE bus.

export type IngestStatus = "VERIFIED" | "WARNING" | "UNVERIFIED";

const MAP: Record<PullStatus, IngestStatus> = {
  verified: "VERIFIED",
  partial: "WARNING",
  invalid: "UNVERIFIED",
};

export function ingestStatusFromPull(status: PullStatus): IngestStatus {
  return MAP[status];
}
