import { getCurrentCommit } from "./git";
import { fetchLatestCommit, fetchLatestRelease } from "./github";

export * from "./git";
export * from "./github";

export interface CheckForUpdatesOptions {
  /** GitHub repo owner, e.g. "leonlange106-lang". */
  owner: string;
  /** GitHub repo name, e.g. "zaehlwerk-app-space". */
  repo: string;
  /** Branch to compare against. Defaults to "main". */
  branch?: string;
  /** Local git checkout to read the current commit from. */
  cwd: string;
}

export interface UpdateCheckResult {
  owner: string;
  repo: string;
  branch: string;
  currentSha: string;
  currentShortSha: string;
  latestSha: string;
  latestShortSha: string;
  latestCommitMessage: string;
  latestCommitDate: string;
  latestCommitUrl: string;
  updateAvailable: boolean;
  /** Set when the repo has a GitHub Release published (this project doesn't, today). */
  latestRelease: {
    tagName: string;
    name: string;
    publishedAt: string;
    htmlUrl: string;
  } | null;
  checkedAt: string;
}

export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<UpdateCheckResult> {
  const branch = options.branch ?? "main";

  const [local, latestCommit, latestRelease] = await Promise.all([
    getCurrentCommit(options.cwd),
    fetchLatestCommit(options.owner, options.repo, branch),
    fetchLatestRelease(options.owner, options.repo).catch(() => null),
  ]);

  return {
    owner: options.owner,
    repo: options.repo,
    branch,
    currentSha: local.sha,
    currentShortSha: local.shortSha,
    latestSha: latestCommit.sha,
    latestShortSha: latestCommit.shortSha,
    latestCommitMessage: latestCommit.message,
    latestCommitDate: latestCommit.authorDate,
    latestCommitUrl: latestCommit.htmlUrl,
    updateAvailable: local.sha !== latestCommit.sha,
    latestRelease: latestRelease
      ? {
          tagName: latestRelease.tagName,
          name: latestRelease.name,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.htmlUrl,
        }
      : null,
    checkedAt: new Date().toISOString(),
  };
}
