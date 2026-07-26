import type { DeployRecord } from "./deploy-history";

// The list of versions this instance may switch to, newest first.
//
// Two sources, because neither is sufficient alone:
//
//   1. The deploy history — what this instance really ran. Authoritative, but
//      empty until the first deploy AFTER this feature ships, and blind to any
//      deploy done by hand on the host.
//   2. The channel's published releases — always available, but says nothing
//      about what this particular instance ever had installed.
//
// Merged on the ref (the git tag), so a version that appears in both is one
// entry carrying both facts: when it was published AND when this instance ran it.
//
// Pure on purpose: no fetch, no fs. The IO lives in the API route, the rules
// live here where they can be tested.

export interface VersionCandidateInput {
  /** Recorded deploys, oldest first (as returned by readDeployHistory). */
  history: DeployRecord[];
  /** Published releases of the active channel, newest first. */
  releases: {
    tagName: string;
    name: string;
    publishedAt: string;
    htmlUrl: string;
    preRelease: boolean;
  }[];
  /** SHA of the build actually running, when known. */
  runningSha?: string | null;
}

export interface VersionCandidate {
  /** Git ref to check out. A tag where one is known, else the bare commit. */
  ref: string;
  /** What to call it in the UI. */
  label: string;
  /** Commit, when known (always known for history entries). */
  sha: string | null;
  /** When GitHub published it, when it is a known release. */
  publishedAt: string | null;
  /** When THIS instance deployed it, when it is in the history. */
  installedAt: string | null;
  htmlUrl: string | null;
  preRelease: boolean;
  /** True when this is the build currently serving. */
  running: boolean;
  /** Where the entry came from — drives the "already ran this" hint in the UI. */
  sources: ("history" | "release")[];
}

/** Sort key: when this instance ran it, else when it was published. */
function orderedAt(candidate: VersionCandidate): number {
  const stamp = candidate.installedAt || candidate.publishedAt;
  const parsed = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Build the ordered version list.
 *
 * `running` is resolved from the SHA where possible. Where the running SHA is
 * unknown (an image built without GIT_SHA), the newest history entry is assumed
 * to be running — it is the last thing this instance deployed, so it is the best
 * available answer and it keeps the UI from offering a rollback to the version
 * you are already on.
 */
export function buildVersionCandidates({
  history,
  releases,
  runningSha,
}: VersionCandidateInput): VersionCandidate[] {
  const byRef = new Map<string, VersionCandidate>();

  const upsert = (ref: string, patch: Partial<VersionCandidate> & { label: string }) => {
    const existing = byRef.get(ref);
    if (existing) {
      byRef.set(ref, {
        ...existing,
        ...patch,
        // Never let a later, thinner source blank out something already known.
        sha: patch.sha ?? existing.sha,
        publishedAt: patch.publishedAt ?? existing.publishedAt,
        installedAt: patch.installedAt ?? existing.installedAt,
        htmlUrl: patch.htmlUrl ?? existing.htmlUrl,
        label: existing.sources.includes("release") ? existing.label : patch.label,
        sources: [...new Set([...existing.sources, ...(patch.sources ?? [])])],
      });
      return;
    }
    byRef.set(ref, {
      ref,
      label: patch.label,
      sha: patch.sha ?? null,
      publishedAt: patch.publishedAt ?? null,
      installedAt: patch.installedAt ?? null,
      htmlUrl: patch.htmlUrl ?? null,
      preRelease: patch.preRelease ?? false,
      running: false,
      sources: patch.sources ?? [],
    });
  };

  for (const release of releases) {
    upsert(release.tagName, {
      label: release.name || release.tagName,
      publishedAt: release.publishedAt,
      htmlUrl: release.htmlUrl,
      preRelease: release.preRelease,
      sources: ["release"],
    });
  }

  // History last so its installedAt/sha land on top of the release entries.
  for (const record of history) {
    // A branch-mode deploy has no tag, but its commit is a perfectly good
    // checkout ref — so it stays rollback-able rather than being dropped.
    const ref = record.ref ?? record.sha;
    upsert(ref, {
      label: record.label,
      sha: record.sha,
      installedAt: record.at || null,
      sources: ["history"],
    });
  }

  const candidates = [...byRef.values()].sort((a, b) => orderedAt(b) - orderedAt(a));

  const trimmedRunning = runningSha?.trim();
  if (trimmedRunning) {
    for (const candidate of candidates) {
      if (candidate.sha === trimmedRunning) candidate.running = true;
    }
  }

  // Fallback: no SHA match (unbaked image, or the running release is not in the
  // history) — treat the most recently INSTALLED entry as the current one.
  if (!candidates.some((candidate) => candidate.running)) {
    const lastInstalled = candidates.find((candidate) => candidate.installedAt);
    if (lastInstalled) lastInstalled.running = true;
  }

  return candidates;
}

/**
 * The refs a rollback request is allowed to name.
 *
 * The rollback endpoint checks out a ref and BUILDS it. Accepting an arbitrary
 * string would therefore make it run any code reachable in the repository — any
 * branch, any fork's merge ref, any commit — which turns a hijacked admin
 * session into remote code execution on the host. So the server re-derives this
 * set on every request and refuses anything outside it. The set is deliberately
 * narrow: versions this instance has run, plus releases its own channel offers.
 */
export function allowedRollbackRefs(candidates: VersionCandidate[]): Set<string> {
  return new Set(candidates.filter((candidate) => !candidate.running).map((c) => c.ref));
}
