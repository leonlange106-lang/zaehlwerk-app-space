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

/** Latest commit on a branch of a public (or token-accessible) GitHub repo. */
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
  return {
    tagName: data.tag_name,
    name: data.name ?? data.tag_name,
    publishedAt: data.published_at,
    htmlUrl: data.html_url,
    targetCommitish: data.target_commitish,
  };
}
