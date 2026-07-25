import { fetchLatestReleaseForChannel, type ReleaseChannel } from "@zaehlwerk/updater";
import { getUpdateChannel } from "./settings";

// What a Self-Update actually checks out, per channel.
//
// A channel points at a TAG, never at a branch head: a branch head is whatever
// was merged last, which is not a state anybody released. `scripts/update.sh`
// takes that tag as `UPDATE_REF`.
//
// The one exception is the fallback below, and it exists because this repo has
// no stable release tags yet — every release so far is a pre-release. Without a
// fallback, an instance on the stable channel would have nothing to update to
// and would simply stop receiving updates, which is a worse failure than
// following the branch. So: when a channel has no published release, the update
// follows `UPDATE_BRANCH` exactly as it did before channels existed, and the UI
// says so rather than pretending the channel is fully wired.

export const REPO_OWNER = "leonlange106-lang";
export const REPO_NAME = "zaehlwerk-app-space";

export function updateBranch(): string {
  return process.env.UPDATE_BRANCH ?? "main";
}

export interface UpdateTarget {
  channel: ReleaseChannel;
  /** Git ref to check out: a release tag, or null when falling back to the branch. */
  ref: string | null;
  /** Human-readable description of what the next update would install. */
  label: string;
  /** True when this channel has no published release and follows the branch. */
  usingBranchFallback: boolean;
}

/** Resolve the ref the next update should install for the stored channel. */
export async function resolveUpdateTarget(): Promise<UpdateTarget> {
  const channel = await getUpdateChannel();
  let release = null;
  try {
    release = await fetchLatestReleaseForChannel(REPO_OWNER, REPO_NAME, channel);
  } catch {
    // GitHub unreachable or rate-limited: fall back to the branch rather than
    // blocking the update entirely.
    release = null;
  }

  if (release) {
    return {
      channel,
      ref: release.tagName,
      label: `${release.name} (${release.tagName})`,
      usingBranchFallback: false,
    };
  }
  return {
    channel,
    ref: null,
    label: `Branch ${updateBranch()}`,
    usingBranchFallback: true,
  };
}
