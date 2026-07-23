import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import {
  IDLE_UPDATE_STATE,
  normalizeUpdateState,
  updateStateKey,
  type RawUpdateStatus,
  type UpdateState,
} from "./update-status";

// Server-side authority for the global update state and its realtime fan-out.
//
// The *persistent* truth lives on the /data volume (status JSON + log) written
// by scripts/update.sh and the detached deployer — that's deliberate: the
// main-portal container is recreated mid-update, so any in-memory state would be
// wiped at the worst moment. This module therefore treats the files as the
// source of truth and layers a thin in-memory pub/sub on top: a single poller
// (active only while at least one client is subscribed) reads the files, and on
// any change broadcasts the normalized state to every connected SSE client on
// this instance. After the mid-update recreate the new container simply reads
// the same files and resumes streaming — no state is lost.

const STATUS_FILE = process.env.UPDATE_STATUS_FILE ?? "/data/update-status.json";
const LOG_FILE = process.env.UPDATE_LOG_FILE ?? "/data/update.log";

// Cap the log tail so a runaway build log can't balloon each SSE frame; the tail
// is what matters for "what's happening right now".
const MAX_LOG_BYTES = 200_000;
const POLL_INTERVAL_MS = 1_000;

const emitter = new EventEmitter();
// One listener per open SSE connection — lift the default cap.
emitter.setMaxListeners(0);

let poller: ReturnType<typeof setInterval> | null = null;
let lastKey = updateStateKey(IDLE_UPDATE_STATE);
let lastState: UpdateState = IDLE_UPDATE_STATE;

async function readRawStatus(): Promise<RawUpdateStatus | null> {
  try {
    return JSON.parse(await readFile(STATUS_FILE, "utf8")) as RawUpdateStatus;
  } catch {
    // No file yet (never updated) or unreadable/half-written → treat as idle.
    return null;
  }
}

async function readLogTail(): Promise<string> {
  try {
    const raw = await readFile(LOG_FILE, "utf8");
    return raw.length > MAX_LOG_BYTES ? raw.slice(raw.length - MAX_LOG_BYTES) : raw;
  } catch {
    return "";
  }
}

/** Read the current normalized state straight from the persistent files. */
export async function readUpdateState(): Promise<UpdateState> {
  const [raw, logs] = await Promise.all([readRawStatus(), readLogTail()]);
  return normalizeUpdateState(raw, logs);
}

async function tick(): Promise<void> {
  let state: UpdateState;
  try {
    state = await readUpdateState();
  } catch {
    return;
  }
  const key = updateStateKey(state);
  if (key === lastKey) return;
  lastKey = key;
  lastState = state;
  emitter.emit("change", state);
}

function ensurePolling(): void {
  if (poller) return;
  poller = setInterval(() => void tick(), POLL_INTERVAL_MS);
  // Kick an immediate read so a change that happened between polls surfaces fast.
  void tick();
}

function maybeStopPolling(): void {
  if (poller && emitter.listenerCount("change") === 0) {
    clearInterval(poller);
    poller = null;
  }
}

/**
 * Subscribe to normalized state changes. The callback fires on every change
 * while subscribed. Returns an unsubscribe function; polling stops automatically
 * once the last subscriber leaves.
 */
export function subscribeUpdateState(onChange: (state: UpdateState) => void): () => void {
  emitter.on("change", onChange);
  ensurePolling();
  return () => {
    emitter.off("change", onChange);
    maybeStopPolling();
  };
}

/** The most recently broadcast state (may be stale between polls; for internal use). */
export function peekUpdateState(): UpdateState {
  return lastState;
}
