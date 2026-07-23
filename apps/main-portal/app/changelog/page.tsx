import { buildChangelog, fetchCommitHistory } from "@zaehlwerk/updater";
import { getRunningBuildSha } from "../lib/version";
import { ChangelogView } from "./ChangelogView";
import type { ChangelogEntry } from "@zaehlwerk/updater";

// Always fetch fresh history from GitHub — the changelog reflects the live repo.
export const dynamic = "force-dynamic";

const REPO_OWNER = "leonlange106-lang";
const REPO_NAME = "zaehlwerk-app-space";

export default async function ChangelogPage() {
  const branch = process.env.UPDATE_BRANCH ?? "main";
  let entries: ChangelogEntry[] = [];
  let error: string | null = null;

  try {
    entries = buildChangelog(await fetchCommitHistory(REPO_OWNER, REPO_NAME, branch, 100));
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Der Changelog konnte nicht von GitHub geladen werden.";
  }

  return <ChangelogView entries={entries} error={error} currentSha={getRunningBuildSha() ?? null} />;
}
