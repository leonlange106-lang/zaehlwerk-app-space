import path from "node:path";
import { getCurrentCommit, type LocalCommitInfo } from "@zaehlwerk/updater";

/** Root of the git checkout. Defaults to two levels up from this app (monorepo layout). */
export function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}

/**
 * SHA of the build actually running, baked into the image at build time
 * (Dockerfile `ARG GIT_SHA` → `ENV APP_GIT_SHA`). This is the honest "current
 * version": unlike the live git checkout, it does NOT move when a `git pull`
 * succeeds but the following rebuild fails. Returns undefined when unset or
 * the placeholder "unknown" (e.g. a manual build that didn't pass GIT_SHA).
 */
export function getRunningBuildSha(): string | undefined {
  const sha = process.env.APP_GIT_SHA;
  return sha && sha !== "unknown" ? sha : undefined;
}

/** Version info for immediate display — the running build if baked, else the git checkout. */
export async function getCurrentVersionInfo(): Promise<LocalCommitInfo | null> {
  const runningSha = getRunningBuildSha();
  if (runningSha) {
    return {
      sha: runningSha,
      shortSha: runningSha.slice(0, 7),
      branch: process.env.UPDATE_BRANCH ?? "main",
    };
  }

  try {
    return await getCurrentCommit(getRepoRoot());
  } catch {
    return null;
  }
}
