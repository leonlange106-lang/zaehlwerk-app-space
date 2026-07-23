// Shared, framework-free model for the System Update workflow. The authoritative
// state is written by scripts/update.sh + scripts/deploy-swap.sh to a JSON file
// on the persistent /data volume (so it survives the container recreation that
// happens mid-update). This module turns that raw file shape into one normalized
// `UpdateState` — the single vocabulary the server (state module, SSE endpoint)
// and the client (progress UI) both speak, so the stage→step mapping is defined
// exactly once. No node/React imports: safe on both sides of the wire.

/** Coarse lifecycle the whole UI keys off. */
export type UpdateStatus = "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";

// The concrete actions of an update, in order. The scripts report a matching
// raw `stage`; everything before the active step is shown as done.
export const UPDATE_STEPS = [
  "Neuer Code geholt (git pull)",
  "Neue Version gebaut",
  "Datenbank migriert",
  "Anwendung neu gestartet",
] as const;

// Raw script stage → index of the currently-active step. `done` = all complete.
export const STAGE_INDEX: Record<string, number> = {
  started: 0,
  pulling: 0,
  building: 1,
  migrating: 2,
  restarting: 3,
  done: UPDATE_STEPS.length,
  failed: 0,
};

/** The raw JSON shape written by the update shell scripts. */
export interface RawUpdateStatus {
  stage?: string;
  ok?: boolean;
  done?: boolean;
  message?: string;
  error?: string;
  targetSha?: string;
  updatedAt?: string;
}

/** The normalized, broadcast-ready update state. */
export interface UpdateState {
  status: UpdateStatus;
  /** Raw script stage (started/pulling/building/migrating/restarting/done/failed/idle). */
  stage: string;
  /** Active step index (0…UPDATE_STEPS.length). */
  stepIndex: number;
  /** Ordered step labels (echoed so the client needn't hardcode them). */
  steps: string[];
  /** Current step label, or null when idle/finished. */
  step: string | null;
  /** Progress percentage 0…100. */
  progress: number;
  /** Latest human-readable status message. */
  message: string;
  /** Failure detail when status is ERROR, else null. */
  error: string | null;
  /** Target commit SHA of the running update, if known. */
  targetSha: string | null;
  /** Tail of the server update log. */
  logs: string;
  /** ISO timestamp of the last state write, or null. */
  updatedAt: string | null;
}

function statusForStage(stage: string, hasRaw: boolean): UpdateStatus {
  if (stage === "failed") return "ERROR";
  if (stage === "done") return "SUCCESS";
  if (!hasRaw || stage === "" || stage === "idle") return "IDLE";
  return "RUNNING";
}

/** Fold a raw status file (+ log tail) into the normalized state. */
export function normalizeUpdateState(
  raw: RawUpdateStatus | null,
  logs = "",
): UpdateState {
  const stage = raw?.stage ?? "idle";
  const status = statusForStage(stage, Boolean(raw));
  const stepIndex = STAGE_INDEX[stage] ?? 0;
  const progress =
    status === "SUCCESS"
      ? 100
      : status === "IDLE"
        ? 0
        : Math.round((stepIndex / UPDATE_STEPS.length) * 100);

  return {
    status,
    stage,
    stepIndex,
    steps: [...UPDATE_STEPS],
    step: status === "SUCCESS" || status === "IDLE" ? null : UPDATE_STEPS[stepIndex] ?? null,
    progress,
    message: raw?.message ?? "",
    error:
      status === "ERROR"
        ? raw?.message || raw?.error || "Update fehlgeschlagen."
        : null,
    targetSha: raw?.targetSha || null,
    logs,
    updatedAt: raw?.updatedAt || null,
  };
}

/** The canonical "nothing happening" state. */
export const IDLE_UPDATE_STATE: UpdateState = normalizeUpdateState(null, "");

/** Serialize the parts that matter for change-detection (drives SSE emits). */
export function updateStateKey(state: UpdateState): string {
  return `${state.status}|${state.stage}|${state.updatedAt ?? ""}|${state.logs.length}`;
}
