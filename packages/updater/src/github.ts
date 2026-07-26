import type { ReleaseChannel } from "./channel";

export interface RemoteCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  authorDate: string;
  htmlUrl: string;
}

export interface RemoteReleaseInfo {
  tagName: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  targetCommitish: string;
  /** GitHub's pre-release flag — what separates the beta channel from stable. */
  preRelease: boolean;
}

interface GithubCommitResponse {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { date: string } | null;
  };
}

interface GithubCommitListItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

/** One commit from the branch history, with the FULL message (subject + body). */
export interface RemoteCommitLogEntry {
  sha: string;
  shortSha: string;
  /** First line of the commit message. */
  subject: string;
  /** Everything after the first line, trimmed. */
  body: string;
  authorName: string;
  authorDate: string;
  htmlUrl: string;
}

interface GithubReleaseResponse {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  target_commitish: string;
  prerelease: boolean;
  draft: boolean;
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * How `head` relates to `base` in the commit graph.
 *
 * This is what tells an update from a downgrade. Comparing two SHAs for
 * inequality cannot: an instance running a beta and a channel offering an older
 * stable have *different* commits, and calling that "an update available" is
 * exactly how the stable channel came to offer beta builds.
 *
 *   ahead     — head is a descendant of base: a real update
 *   behind    — base is a descendant of head: the running build is NEWER
 *   identical — same commit
 *   diverged  — neither is an ancestor of the other
 */
export type CommitComparison = "ahead" | "behind" | "identical" | "diverged";

/**
 * Does a comparison result mean "there is an update to install"?
 *
 * The rule, isolated so it can be tested without a network:
 *
 *  - `ahead`     yes — the channel's release is a descendant of what we run.
 *  - `diverged`  yes — a released state on another line of history. Not
 *                reachable while every release is cut from `main`, but if it
 *                ever is, a published release still outranks an unreleased
 *                local build.
 *  - `behind`    NO — the running build is newer. This is the everyday result
 *                of testing a beta and switching back to stable, and calling it
 *                an update is what made the stable channel offer beta builds.
 *  - `identical` NO.
 */
export function updateAvailableFor(comparison: CommitComparison): boolean {
  return comparison === "ahead" || comparison === "diverged";
}

export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<CommitComparison> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    { headers: githubHeaders(), cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`GitHub compare request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { status?: string };
  switch (data.status) {
    case "ahead":
    case "behind":
    case "identical":
      return data.status;
    default:
      return "diverged";
  }
}

/**
 * Latest commit on a branch of a public (or token-accessible) GitHub repo.
 *
 * The endpoint resolves ANY ref, so this also turns a release tag into its
 * commit — including annotated tags, which it dereferences for us.
 */
export async function fetchLatestCommit(
  owner: string,
  repo: string,
  branch: string,
): Promise<RemoteCommitInfo> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    { headers: githubHeaders(), cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`GitHub commits request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GithubCommitResponse;
  return {
    sha: data.sha,
    shortSha: data.sha.slice(0, 7),
    message: data.commit.message.split("\n")[0] ?? data.commit.message,
    authorDate: data.commit.author?.date ?? "",
    htmlUrl: data.html_url,
  };
}

/**
 * Recent commit history of a branch, newest first — the raw material for the
 * in-app changelog. Returns the full message so the changelog can split off a
 * body and parse the Conventional-Commit subject (see changelog.ts).
 */
export async function fetchCommitHistory(
  owner: string,
  repo: string,
  branch: string,
  perPage = 100,
): Promise<RemoteCommitLogEntry[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
    { headers: githubHeaders(), cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub commit history request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GithubCommitListItem[];
  return data.map((item) => {
    const lines = item.commit.message.split("\n");
    return {
      sha: item.sha,
      shortSha: item.sha.slice(0, 7),
      subject: lines[0] ?? "",
      body: lines.slice(1).join("\n").trim(),
      authorName: item.commit.author?.name ?? "",
      authorDate: item.commit.author?.date ?? "",
      htmlUrl: item.html_url,
    };
  });
}

/**
 * Latest published release, or `null` if the repo has none (this project
 * currently ships no tagged releases — commit comparison is the primary
 * signal, this is a bonus when releases do exist).
 */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
): Promise<RemoteReleaseInfo | null> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GithubReleaseResponse;
  return toReleaseInfo(data);
}

function toReleaseInfo(data: GithubReleaseResponse): RemoteReleaseInfo {
  return {
    tagName: data.tag_name,
    name: data.name ?? data.tag_name,
    publishedAt: data.published_at,
    htmlUrl: data.html_url,
    targetCommitish: data.target_commitish,
    preRelease: data.prerelease,
  };
}

/**
 * The newest release for a channel, or null when the channel has none.
 *
 * `releases/latest` cannot answer this: GitHub excludes pre-releases from it
 * entirely, so a beta would be invisible. This lists releases (newest first) and
 * filters:
 *
 *  - stable: published, not a pre-release
 *  - beta:   published, of EITHER maturity
 *
 * Beta deliberately includes stable releases. A stable that lands after the last
 * beta is newer, and a beta tester should move onto it rather than sit on an
 * older pre-release forever. Drafts are never offered on either channel — they
 * are unpublished by definition.
 */
export async function fetchLatestReleaseForChannel(
  owner: string,
  repo: string,
  channel: ReleaseChannel,
): Promise<RemoteReleaseInfo | null> {
  const releases = await fetchReleasesForChannel(owner, repo, channel);
  return releases[0] ?? null;
}

/**
 * Every published release a channel offers, newest first.
 *
 * Same filter as {@link fetchLatestReleaseForChannel} — that function is now
 * just "the first of these". The full list is what a rollback needs: the
 * versions this instance could go back to are precisely the ones its channel
 * would have been willing to install in the first place.
 */
export async function fetchReleasesForChannel(
  owner: string,
  repo: string,
  channel: ReleaseChannel,
  perPage = 30,
): Promise<RemoteReleaseInfo[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${perPage}`,
    { headers: githubHeaders(), cache: "no-store" },
  );

  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GithubReleaseResponse[];
  const usable = data.filter((r) => !r.draft && (channel === "beta" || !r.prerelease));
  // GitHub returns releases newest-first by creation, but published_at is the
  // date that actually matters and can differ — sort on it rather than trust it.
  usable.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  return usable.map(toReleaseInfo);
}
