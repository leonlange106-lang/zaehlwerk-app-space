import { readFile } from "node:fs/promises";

// What this instance has actually deployed, in order.
//
// Written by scripts/deploy-swap.sh at the moment a swap succeeds — NOT by the
// app. The app cannot be the writer: it is killed and recreated by the very
// deploy it would be recording, so it would either miss the entry or write it
// from a process that no longer represents the truth. The deployer container
// survives the swap, which is exactly why it also writes the final status.
//
// Format is JSON Lines, one record per line, appended with `>>`. A JSON *array*
// would have to be re-read, re-serialised and rewritten by a `sh` script with no
// jq available — a read-modify-write on the one file that must survive a deploy.
// Append-only has no such failure mode: a torn write costs one line, and
// `parseDeployHistory` drops unparseable lines instead of losing the file.
//
// This file lives on the /data volume, so it outlives the container.

const HISTORY_FILE = process.env.DEPLOY_HISTORY_FILE ?? "/data/deploy-history.jsonl";

// A deploy every day for a year would still be a small file, but there is no
// reason to parse more than the UI can use. Read the tail, not the whole thing.
const MAX_HISTORY_BYTES = 64_000;

/** One recorded deploy. Field names match what deploy-swap.sh writes. */
export interface DeployRecord {
  /** ISO timestamp of the swap. */
  at: string;
  /** Commit the image was built from. */
  sha: string;
  /** Released tag that was checked out, or null for a branch-mode deploy. */
  ref: string | null;
  /** Human-readable release name, as resolved when the deploy was triggered. */
  label: string;
  /** Channel the instance followed at the time. */
  channel: string;
  /** Whether this deploy moved forward or back. */
  mode: "update" | "rollback";
}

function toRecord(value: unknown): DeployRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sha = typeof raw.sha === "string" ? raw.sha.trim() : "";
  // A record without a commit cannot be rolled back to and cannot be compared
  // against the running build, so it is not a record — drop it.
  if (!sha) return null;

  const ref = typeof raw.ref === "string" && raw.ref.trim() ? raw.ref.trim() : null;
  return {
    at: typeof raw.at === "string" ? raw.at : "",
    sha,
    ref,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : (ref ?? sha.slice(0, 7)),
    channel: typeof raw.channel === "string" && raw.channel.trim() ? raw.channel.trim() : "stable",
    mode: raw.mode === "rollback" ? "rollback" : "update",
  };
}

/**
 * Parse the JSONL history, oldest first.
 *
 * Tolerant by design: a half-written final line (the container was recreated
 * mid-append) must not take the whole history with it, so unparseable lines are
 * skipped rather than thrown on.
 */
export function parseDeployHistory(raw: string): DeployRecord[] {
  const records: DeployRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const record = toRecord(parsed);
    if (record) records.push(record);
  }
  return records;
}

/** Read the recorded deploy history, oldest first. Empty when nothing is recorded yet. */
export async function readDeployHistory(): Promise<DeployRecord[]> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_FILE, "utf8");
  } catch {
    // No file yet (never deployed through the updater), or /data unreadable in a
    // dev setup. An empty history is a valid state, not an error: the version
    // list falls back to the channel's published releases.
    return [];
  }
  if (raw.length > MAX_HISTORY_BYTES) {
    // Drop the (probably partial) first line after slicing mid-file.
    raw = raw.slice(raw.length - MAX_HISTORY_BYTES).replace(/^[^\n]*\n/, "");
  }
  return parseDeployHistory(raw);
}
