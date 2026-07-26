import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReleaseChannel } from "@zaehlwerk/updater";

// Starting a deploy — the one code path shared by "update" and "rollback".
//
// A rollback is NOT a second deploy mechanism. It is the same scripts/update.sh
// run with a different ref and one flag, which is the entire reason it can be
// trusted: the risky, hard-to-test part (build → migrate → detached swap) has
// exactly one implementation, exercised by every update.

const STATUS_FILE = process.env.UPDATE_STATUS_FILE ?? "/data/update-status.json";

export type DeployMode = "update" | "rollback";

export interface DeployRunOptions {
  /** Git ref to check out. Null follows UPDATE_BRANCH (branch mode). */
  ref: string | null;
  /** Human-readable name of the target, recorded in the deploy history. */
  label: string;
  channel: ReleaseChannel;
  mode: DeployMode;
}

/**
 * Strip what would break the shell scripts' hand-rolled JSON.
 *
 * The label travels through an env var into `printf '{"label":"%s"}'` in
 * deploy-swap.sh, which has no escaping. A release named `he said "hi"` would
 * emit invalid JSON and cost the history entry. Release names are display text,
 * so dropping quotes, backslashes and control characters (`\p{Cc}`, which
 * includes the newline that would split one record into two) loses nothing that
 * matters and keeps the history parseable.
 */
export function sanitizeDeployLabel(label: string): string {
  return (
    label
      .replace(/[\p{Cc}"\\]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "unbenannt"
  );
}

/** True when UPDATE_TRIGGER_TOKEN is configured, i.e. the UI must ask for it. */
export function updateTokenRequired(): boolean {
  return Boolean(process.env.UPDATE_TRIGGER_TOKEN);
}

/**
 * Check the optional shared secret guarding deploy endpoints.
 *
 * This is an ADDITIONAL gate on top of the admin session, never a substitute —
 * both the update and the rollback endpoint check the session first. Compared in
 * constant time so the header cannot be brute-forced a byte at a time.
 */
export function updateTokenAccepted(provided: string | null): boolean {
  const expected = process.env.UPDATE_TRIGGER_TOKEN;
  if (!expected) return true;
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

function scriptPath(): string {
  return (
    process.env.UPDATE_SCRIPT_PATH ??
    path.resolve(process.cwd(), "..", "..", "scripts", "update.sh")
  );
}

/**
 * Write the initial "started" status and spawn the deploy script detached.
 *
 * The status write happens BEFORE the spawn and is awaited, so the UI can never
 * read a stale "done" left on disk by a previous run and report false success in
 * the window before the script's own first write.
 */
export async function startDeployRun(options: DeployRunOptions): Promise<void> {
  const verb = options.mode === "rollback" ? "Rollback" : "Update";
  try {
    await writeFile(
      STATUS_FILE,
      JSON.stringify({
        stage: "started",
        ok: true,
        done: false,
        message: `${verb} wird gestartet`,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // /data not writable in some dev setups — the script writes status too.
  }

  const child = spawn("sh", [scriptPath()], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      // Empty = follow UPDATE_BRANCH, exactly as before channels existed.
      UPDATE_REF: options.ref ?? "",
      UPDATE_MODE: options.mode,
      UPDATE_LABEL: sanitizeDeployLabel(options.label),
      UPDATE_CHANNEL: options.channel,
    },
  });
  child.unref();
}
