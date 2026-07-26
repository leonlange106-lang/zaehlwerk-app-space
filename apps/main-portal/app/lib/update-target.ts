import { fetchLatestReleaseForChannel, type ReleaseChannel } from "@zaehlwerk/updater";
import { getUpdateChannel } from "./settings";

// What a Self-Update actually checks out, per channel.
//
// A channel points at a TAG, never at a branch head: a branch head is whatever
// was merged last, which is not a state anybody released. `scripts/update.sh`
// takes that tag as `UPDATE_REF`.
//
// This used to fall back to the branch whenever a channel had no release, on the
// reasoning that receiving no updates is worse than following `main`. It is not:
// an instance on the stable channel then silently installed unreleased code —
// including the pre-release commits it had specifically opted out of. A channel
// with nothing published now offers nothing, and says so.
//
// The fallback survives only as an explicit developer mode. It has to be turned
// on deliberately, per instance, and the UI labels the target as a branch.

export const REPO_OWNER = "leonlange106-lang";
export const REPO_NAME = "zaehlwerk-app-space";

export function updateBranch(): string {
  return process.env.UPDATE_BRANCH ?? "main";
}

/**
 * Developer mode: deploy the branch head when the channel has no release.
 *
 * Deliberately opt-in and env-only — there is no UI for it, because an instance
 * that follows a branch is not running a released version and nobody should
 * arrive there by clicking.
 */
export function branchFallbackAllowed(): boolean {
  const value = process.env.UPDATE_ALLOW_BRANCH;
  return value === "1" || value === "true";
}

export interface UpdateTarget {
  channel: ReleaseChannel;
  /** Git ref to check out: a release tag, or null when following the branch. */
  ref: string | null;
  /** Human-readable description of what the next update would install. */
  label: string;
  /** True when this channel has no published release and follows the branch. */
  usingBranchFallback: boolean;
  /** True when there is nothing this instance can install right now. */
  unavailable: boolean;
}

/** Resolve the ref the next update should install for the stored channel. */
export async function resolveUpdateTarget(): Promise<UpdateTarget> {
  const channel = await getUpdateChannel();
  let release = null;
  try {
    release = await fetchLatestReleaseForChannel(REPO_OWNER, REPO_NAME, channel);
  } catch {
    // GitHub unreachable or rate-limited. Reported as "nothing to install right
    // now" rather than quietly deploying the branch — a network blip must not
    // change WHICH code an instance runs.
    release = null;
  }

  if (release) {
    return {
      channel,
      ref: release.tagName,
      label: `${release.name} (${release.tagName})`,
      usingBranchFallback: false,
      unavailable: false,
    };
  }

  if (branchFallbackAllowed()) {
    return {
      channel,
      ref: null,
      label: `Branch ${updateBranch()} (Entwicklermodus)`,
      usingBranchFallback: true,
      unavailable: false,
    };
  }

  return {
    channel,
    ref: null,
    label: `Keine veröffentlichte Version im Channel „${channel}“`,
    usingBranchFallback: false,
    unavailable: true,
  };
}
