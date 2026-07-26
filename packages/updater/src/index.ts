import { getCurrentCommit } from "./git";
import {
  compareCommits,
  fetchLatestCommit,
  fetchLatestReleaseForChannel,
  updateAvailableFor,
} from "./github";
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
  /**
   * Follow the branch head when the channel has no published release.
   *
   * Off by default, and it should stay off in production: a branch head is
   * whatever was merged last, which is not a state anybody released. Exists as
   * an explicit developer mode (`UPDATE_ALLOW_BRANCH`).
   */
  allowBranchFallback?: boolean;
}

export interface UpdateCheckResult {
  owner: string;
  repo: string;
  branch: string;
  currentSha: string;
  currentShortSha: string;
  /**
   * The commit the CHANNEL would install — the release's commit, not the branch
   * head. Empty when the channel has nothing to offer.
   */
  latestSha: string;
  latestShortSha: string;
  latestCommitMessage: string;
  latestCommitDate: string;
  latestCommitUrl: string;
  updateAvailable: boolean;
  /** The channel this result describes. */
  channel: ReleaseChannel;
  /** How the target relates to the running build, when GitHub could tell us. */
  comparison: "ahead" | "behind" | "identical" | "diverged" | null;
  /**
   * True when the graph comparison could not be made (GitHub unreachable, or a
   * commit it does not know). `updateAvailable` then falls back to "the SHAs
   * differ", which cannot distinguish an update from a downgrade.
   */
  comparisonUnavailable: boolean;
  /** True when the channel has no published release at all. */
  noReleaseInChannel: boolean;
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

/**
 * Is there something newer for this instance to install?
 *
 * Answered against the CHANNEL'S RELEASE, never the branch head. The previous
 * version compared the running build to `main`, which made every instance —
 * including one on the stable channel — see any merged commit as an available
 * update, and made a stable instance running a beta build believe it was behind
 * when it was in fact ahead. Both are the same mistake: a branch head is not a
 * release, and "different" is not "newer".
 */
export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<UpdateCheckResult> {
  const branch = options.branch ?? "main";
  const channel = options.channel ?? DEFAULT_RELEASE_CHANNEL;

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

  const [local, latestRelease] = await Promise.all([
    localPromise,
    // Never fatal: a channel with no release is a valid state, reported below.
    fetchLatestReleaseForChannel(options.owner, options.repo, channel).catch(() => null),
  ]);

  // Resolve what would actually be checked out. A tag, normally; the branch head
  // only in the explicit developer mode.
  let target = null;
  if (latestRelease) {
    target = await fetchLatestCommit(options.owner, options.repo, latestRelease.tagName).catch(
      () => null,
    );
  } else if (options.allowBranchFallback) {
    target = await fetchLatestCommit(options.owner, options.repo, branch).catch(() => null);
  }

  let comparison: UpdateCheckResult["comparison"] = null;
  let comparisonUnavailable = false;
  let updateAvailable = false;

  if (target) {
    if (target.sha === local.sha) {
      comparison = "identical";
    } else {
      try {
        comparison = await compareCommits(options.owner, options.repo, local.sha, target.sha);
        updateAvailable = updateAvailableFor(comparison);
      } catch {
        // Degrade to the old, weaker signal rather than blocking updates
        // outright — but say so, because it cannot tell a downgrade apart.
        comparisonUnavailable = true;
        updateAvailable = true;
      }
    }
  }

  return {
    owner: options.owner,
    repo: options.repo,
    branch,
    currentSha: local.sha,
    currentShortSha: local.shortSha,
    latestSha: target?.sha ?? "",
    latestShortSha: target?.shortSha ?? "",
    latestCommitMessage: target?.message ?? "",
    latestCommitDate: target?.authorDate ?? "",
    latestCommitUrl: target?.htmlUrl ?? "",
    updateAvailable,
    channel,
    comparison,
    comparisonUnavailable,
    noReleaseInChannel: latestRelease === null,
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
