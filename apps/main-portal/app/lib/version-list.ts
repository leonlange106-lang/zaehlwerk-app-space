import { fetchReleasesForChannel, type ReleaseChannel } from "@zaehlwerk/updater";
import { readDeployHistory } from "./deploy-history";
import { getUpdateChannel } from "./settings";
import { REPO_NAME, REPO_OWNER } from "./update-target";
import { getRunningBuildSha } from "./version";
import { buildVersionCandidates, type VersionCandidate } from "./version-candidates";

// Resolving the version list is IO (a file on /data + one GitHub call); deciding
// what the list MEANS is pure (version-candidates.ts). This module is the seam.
//
// Both the listing endpoint and the rollback endpoint call this, and that is not
// an efficiency detail — it is the security property. The rollback endpoint
// re-derives the allowed refs from the same code path that produced the buttons,
// so the set it validates against cannot drift from the set the UI offered.

export interface VersionListResult {
  channel: ReleaseChannel;
  runningSha: string | null;
  candidates: VersionCandidate[];
  /** True when GitHub could not be reached — the list is history-only. */
  releasesUnavailable: boolean;
}

export async function resolveVersionList(): Promise<VersionListResult> {
  const channel = await getUpdateChannel();
  const runningSha = getRunningBuildSha() ?? null;

  const [history, releaseResult] = await Promise.all([
    readDeployHistory(),
    fetchReleasesForChannel(REPO_OWNER, REPO_NAME, channel).then(
      (releases) => ({ releases, failed: false }),
      // GitHub unreachable or rate-limited. The deploy history is local and
      // still usable, and rolling back is exactly the moment you least want a
      // hard dependency on an external service — so degrade instead of failing.
      () => ({ releases: [], failed: true }),
    ),
  ]);

  return {
    channel,
    runningSha,
    candidates: buildVersionCandidates({
      history,
      releases: releaseResult.releases,
      runningSha,
    }),
    releasesUnavailable: releaseResult.failed,
  };
}
