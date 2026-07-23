// One-shot handoff of the "log to open" between routes (Overview / Remote Import
// → Analyzer). Only a log id travels through sessionStorage now — the log itself
// lives server-side (see log-api.ts / log-repository.ts). The target route reads
// the id once and fetches the full record from the server.

const ACTIVE_ID_KEY = "log-analyzer:active-id";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** Stash a log id for the next route to pick up (one-shot). */
export function setActiveLogId(id: string): void {
  if (!hasWindow()) return;
  try {
    sessionStorage.setItem(ACTIVE_ID_KEY, id);
  } catch {
    // sessionStorage unavailable — the target route just shows its empty state.
  }
}

/** Read and CLEAR the pending active log id, if any. */
export function takeActiveLogId(): string | null {
  if (!hasWindow()) return null;
  try {
    const id = sessionStorage.getItem(ACTIVE_ID_KEY);
    if (id) sessionStorage.removeItem(ACTIVE_ID_KEY);
    return id;
  } catch {
    return null;
  }
}
