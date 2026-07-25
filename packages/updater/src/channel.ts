// The release channel an instance follows.
//
// Its own module because everything else needs it: the GitHub client filters
// releases by it, the check API reports it, the settings UI writes it, and the
// deploy script receives the ref it resolves to. Keeping the type and its
// parsing here means those four never drift apart.
//
// GitHub is the source of truth for what a channel contains:
//   stable — releases without the pre-release flag
//   beta   — every published release, of either maturity
//
// Beta includes stable on purpose. A stable release published after the last
// beta IS newer, and a tester should be moved onto it rather than left sitting
// on an older pre-release indefinitely.

export type ReleaseChannel = "stable" | "beta";

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "beta"] as const;

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "stable";

/** Parse an untrusted value (env var, DB column) into a channel. */
export function toReleaseChannel(value: unknown): ReleaseChannel {
  return value === "beta" ? "beta" : DEFAULT_RELEASE_CHANNEL;
}
