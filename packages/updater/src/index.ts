import { getCurrentCommit } from "./git";
import { fetchLatestCommit, fetchLatestReleaseForChannel } from "./github";
import { DEFAULT_RELEASE_CHANNEL, type ReleaseChannel } from "./channel";

export * from "./git";
export * from "./github";
export * from "./changelog";
export * from "./channel";

export interface CheckForUpdatesOptions {
  /** GitHub repo owner, e.g. "leonlange106-lang". */
  owner: string;
  /** GitHub repo name, e.g. "zaehlwerk-app-space". */
  repo: string;
  /** Branch to compare against. Defaults to "main". */
  branch?: string;
  /**
   * SHA of the **currently running build**, if known (e.g. baked into the
   * image at build time). Prefer this over reading git: the git checkout can
   * be pulled ahead of the running build (e.g. a pull succeeded but the
   * rebuild failed), and comparing against the checkout would then wrongly
   * report "up to date" while the app actually still runs old code.
   */
  currentSha?: string;
  /** Local git checkout to read the current commit from — fallback when `currentSha` is absent. */
  cwd?: string;
  /** Release channel to look for updates in. Defaults to "stable". */
  channel?: ReleaseChannel;
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
  /** The channel this result describes. */
  channel: ReleaseChannel;
  /**
   * Newest release IN THE SELECTED CHANNEL, or null when the channel has none
   * published yet. `tagName` is the ref the deploy script checks out — a branch
   * head is not a released state, so an update always targets a tag.
   */
  latestRelease: {
    tagName: string;
    name: string;
    publishedAt: string;
    htmlUrl: string;
    preRelease: boolean;
  } | null;
  checkedAt: string;
}

export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<UpdateCheckResult> {
  const branch = options.branch ?? "main";

  // Prefer the baked running-build SHA; only fall back to reading the git
  // checkout when it isn't known.
  const localPromise =
    options.currentSha && options.currentSha !== "unknown"
      ? Promise.resolve({
          sha: options.currentSha,
          shortSha: options.currentSha.slice(0, 7),
          branch,
        })
      : getCurrentCommit(options.cwd ?? process.cwd());

  const channel = options.channel ?? DEFAULT_RELEASE_CHANNEL;

  const [local, latestCommit, latestRelease] = await Promise.all([
    localPromise,
    fetchLatestCommit(options.owner, options.repo, branch),
    // Never fatal: a repo with no releases is a valid state, and the commit
    // comparison below still answers "is there anything new".
    fetchLatestReleaseForChannel(options.owner, options.repo, channel).catch(() => null),
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
    channel,
    latestRelease: latestRelease
      ? {
          tagName: latestRelease.tagName,
          name: latestRelease.name,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.htmlUrl,
          preRelease: latestRelease.preRelease,
        }
      : null,
    checkedAt: new Date().toISOString(),
  };
}
