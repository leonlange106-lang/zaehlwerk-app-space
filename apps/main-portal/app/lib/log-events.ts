import { EventEmitter } from "node:events";
import type { PullHealth, PullStatus } from "../apps/log-analyzer/lib/evaluate-log-pull";
import type { IngestStatus } from "./log-ingest-status";

// Lightweight in-process pub/sub for "a log was just ingested" events, so the
// log overview can refresh in realtime (SSE) the moment a log lands via the
// ingestion API or the watch-folder — mirroring the update-state bus, but
// push-driven (no file poller): producers call `broadcastLogIngested`, the SSE
// route subscribes.
//
// This is per-instance and in-memory by design. Prod runs a single app
// container, and both the ingestion API route and the watch-folder run inside
// that same Node process, so every producer reaches every connected browser on
// this instance. If the container is recreated, EventSource simply reconnects.

/** The realtime payload a client receives when a new log is ingested. */
export interface LogIngestedEvent {
  type: "ingested";
  id: string;
  name: string;
  /** Pull verdict: verified | partial | invalid. */
  status: PullStatus;
  /** UPPER-CASE ingestion status for external consumers: VERIFIED | WARNING | UNVERIFIED. */
  ingestStatus: IngestStatus;
  health: PullHealth;
  /** How it entered: "ingest" (API) or "watch" (watch-folder). */
  source: string;
  /** True when the file was a duplicate (already stored) and thus not re-imported. */
  duplicate: boolean;
  /** ISO timestamp of the event. */
  at: string;
}

const emitter = new EventEmitter();
// One listener per open SSE connection — lift the default cap.
emitter.setMaxListeners(0);

const CHANNEL = "log-ingested";

/** Broadcast a log-ingested event to every subscriber on this instance. */
export function broadcastLogIngested(event: LogIngestedEvent): void {
  emitter.emit(CHANNEL, event);
}

/**
 * Subscribe to log-ingested events. The callback fires for every event while
 * subscribed. Returns an unsubscribe function.
 */
export function subscribeLogEvents(onEvent: (event: LogIngestedEvent) => void): () => void {
  emitter.on(CHANNEL, onEvent);
  return () => emitter.off(CHANNEL, onEvent);
}
