import path from "node:path";
import { getCurrentCommit, type LocalCommitInfo } from "@zaehlwerk/updater";

/** Root of the git checkout. Defaults to two levels up from this app (monorepo layout). */
export function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}

/** Cheap, local-only version info (no network call) for immediate display. */
export async function getCurrentVersionInfo(): Promise<LocalCommitInfo | null> {
  try {
    return await getCurrentCommit(getRepoRoot());
  } catch {
    return null;
  }
}
