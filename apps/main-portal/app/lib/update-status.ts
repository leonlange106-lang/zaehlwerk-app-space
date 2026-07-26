import { parseBuildProgress } from "./build-progress";

// Shared, framework-free model for the System Update workflow. The authoritative
// state is written by scripts/update.sh + scripts/deploy-swap.sh to a JSON file
// on the persistent /data volume (so it survives the container recreation that
// happens mid-update). This module turns that raw file shape into one normalized
// `UpdateState` — the single vocabulary the server (state module, SSE endpoint)
// and the client (progress UI) both speak, so the stage→step mapping is defined
// exactly once. No node/React imports: safe on both sides of the wire.

/** Coarse lifecycle the whole UI keys off. */
// CANCELLED is its own state, not a flavour of ERROR: nothing went wrong, the
// operator stopped it, and the old build is still serving. Reporting that as a
// failure would send people hunting through the log for a cause that isn't there.
export type UpdateStatus = "IDLE" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";

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
  cancelled: 0,
};

/**
 * Stages an update may still be stopped in.
 *
 * Up to and including the migration, the OLD container is still serving and
 * nothing has been swapped — aborting costs a wasted build and nothing else.
 * From `restarting` on, the detached deployer is recreating containers, and
 * killing it there would leave the stack half-swapped: exactly the state the
 * whole detached-deployer design exists to avoid.
 */
export const CANCELLABLE_STAGES = new Set(["started", "pulling", "building", "migrating"]);

export function isCancellable(state: Pick<UpdateState, "status" | "stage">): boolean {
  return state.status === "RUNNING" && CANCELLABLE_STAGES.has(state.stage);
}

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
  /** BuildKit sub-progress while building, e.g. "builder 5/9". Null otherwise. */
  buildStep: string | null;
  /** The command BuildKit is currently running, when known. */
  buildLabel: string | null;
  /** Target commit SHA of the running update, if known. */
  targetSha: string | null;
  /** Tail of the server update log. */
  logs: string;
  /** ISO timestamp of the last state write, or null. */
  updatedAt: string | null;
}

function statusForStage(stage: string, hasRaw: boolean): UpdateStatus {
  if (stage === "cancelled") return "CANCELLED";
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
  // Inside the build stage the coarse number would sit still for minutes, so the
  // BuildKit sub-progress fills that span instead: step 2 of 4 spans 25…50%, and
  // the build's own percentage is mapped into it.
  const build = stage === "building" ? parseBuildProgress(logs) : { current: null, percent: null, summary: null };
  const stageFraction = stepIndex / UPDATE_STEPS.length;
  const withinStage =
    stage === "building" && build.percent !== null
      ? (build.percent / 100) * (1 / UPDATE_STEPS.length)
      : 0;
  const progress =
    status === "SUCCESS"
      ? 100
      : status === "IDLE"
        ? 0
        : Math.min(100, Math.round((stageFraction + withinStage) * 100));

  return {
    status,
    stage,
    stepIndex,
    steps: [...UPDATE_STEPS],
    step:
      status === "SUCCESS" || status === "IDLE" || status === "CANCELLED"
        ? null
        : UPDATE_STEPS[stepIndex] ?? null,
    progress,
    message: raw?.message ?? "",
    error:
      status === "ERROR"
        ? raw?.message || raw?.error || "Update fehlgeschlagen."
        : null,
    buildStep: build.summary,
    buildLabel: build.current?.label ?? null,
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
