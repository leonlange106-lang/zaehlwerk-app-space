// Turns raw Git commit history into structured, filterable changelog entries.
// Pure module — no Node built-ins — so its TYPES are safe to import from a
// client component (the actual parsing runs server-side in the changelog page).

import type { RemoteCommitLogEntry } from "./github";

export type ChangelogType =
  | "feat"
  | "fix"
  | "perf"
  | "refactor"
  | "docs"
  | "chore"
  | "test"
  | "build"
  | "ci"
  | "style"
  | "revert"
  | "other";

/** Conventional-Commit prefixes we recognise; anything else becomes "other". */
const KNOWN_TYPES: readonly ChangelogType[] = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "chore",
  "test",
  "build",
  "ci",
  "style",
  "revert",
];

/** German labels for the UI (badges, filters). */
export const CHANGELOG_TYPE_LABELS: Record<ChangelogType, string> = {
  feat: "Feature",
  fix: "Fehlerbehebung",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Dokumentation",
  chore: "Wartung",
  test: "Tests",
  build: "Build",
  ci: "CI",
  style: "Style",
  revert: "Zurückgenommen",
  other: "Sonstiges",
};

export interface ChangelogEntry {
  sha: string;
  shortSha: string;
  type: ChangelogType;
  /** Conventional-Commit scope, e.g. `updater` in `fix(updater): …`. */
  scope: string | null;
  /** Human-readable subject with the `type(scope):` prefix and `(#NN)` stripped. */
  subject: string;
  /** Commit body (everything after the first line), possibly empty. */
  body: string;
  /** Pull-request number parsed from a trailing `(#NN)` (squash-merge style). */
  prNumber: number | null;
  authorName: string;
  /** ISO date string. */
  date: string;
  /** Link to the commit on GitHub. */
  url: string;
  breaking: boolean;
}

/** Parse a single commit subject line into its Conventional-Commit parts. */
export function parseConventionalSubject(subject: string): {
  type: ChangelogType;
  scope: string | null;
  cleaned: string;
  prNumber: number | null;
  breaking: boolean;
} {
  const prMatch = subject.match(/\(#(\d+)\)\s*$/);
  const prNumber = prMatch ? Number(prMatch[1]) : null;
  const withoutPr = subject.replace(/\s*\(#\d+\)\s*$/, "").trim();

  const match = withoutPr.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/);
  if (match && KNOWN_TYPES.includes(match[1].toLowerCase() as ChangelogType)) {
    const cleaned = match[4].trim();
    return {
      type: match[1].toLowerCase() as ChangelogType,
      scope: match[2] ?? null,
      breaking: match[3] === "!",
      cleaned: cleaned || withoutPr,
      prNumber,
    };
  }

  return { type: "other", scope: null, breaking: false, cleaned: withoutPr, prNumber };
}

/** Convert raw commit history into structured, display-ready changelog entries. */
export function buildChangelog(commits: RemoteCommitLogEntry[]): ChangelogEntry[] {
  return commits.map((commit) => {
    const parsed = parseConventionalSubject(commit.subject);
    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      type: parsed.type,
      scope: parsed.scope,
      subject: parsed.cleaned,
      body: commit.body,
      prNumber: parsed.prNumber,
      authorName: commit.authorName,
      date: commit.authorDate,
      url: commit.htmlUrl,
      breaking: parsed.breaking || /BREAKING[ -]CHANGE/.test(commit.body),
    };
  });
}
