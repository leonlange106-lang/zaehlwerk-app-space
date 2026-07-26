import { describe, expect, it } from "vitest";
import { allowedRollbackRefs, buildVersionCandidates } from "./version-candidates";
import type { DeployRecord } from "./deploy-history";

function record(overrides: Partial<DeployRecord> = {}): DeployRecord {
  return {
    at: "2026-07-01T10:00:00Z",
    sha: "a".repeat(40),
    ref: "v1.0.0",
    label: "1.0.0",
    channel: "stable",
    mode: "update",
    ...overrides,
  };
}

function release(tagName: string, publishedAt: string, preRelease = false) {
  return {
    tagName,
    name: tagName.replace(/^v/, ""),
    publishedAt,
    htmlUrl: `https://example.test/${tagName}`,
    preRelease,
  };
}

describe("buildVersionCandidates", () => {
  it("merges a version present in both sources into one entry", () => {
    const candidates = buildVersionCandidates({
      history: [record({ ref: "v1.0.0", sha: "a1", at: "2026-07-02T00:00:00Z" })],
      releases: [release("v1.0.0", "2026-07-01T00:00:00Z")],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      ref: "v1.0.0",
      sha: "a1",
      publishedAt: "2026-07-01T00:00:00Z",
      installedAt: "2026-07-02T00:00:00Z",
    });
    // Both facts survive the merge — that is the whole point of merging on ref.
    expect(candidates[0].sources.sort()).toEqual(["history", "release"]);
  });

  it("orders newest first, preferring when this instance ran it", () => {
    const candidates = buildVersionCandidates({
      history: [
        record({ ref: "v1.0.0", sha: "a1", at: "2026-07-01T00:00:00Z" }),
        record({ ref: "v3.0.0", sha: "c3", at: "2026-07-20T00:00:00Z" }),
      ],
      releases: [release("v2.0.0", "2026-07-10T00:00:00Z")],
    });

    expect(candidates.map((c) => c.ref)).toEqual(["v3.0.0", "v2.0.0", "v1.0.0"]);
  });

  it("marks the running build by SHA, not by position", () => {
    const candidates = buildVersionCandidates({
      history: [
        record({ ref: "v1.0.0", sha: "a1", at: "2026-07-01T00:00:00Z" }),
        record({ ref: "v2.0.0", sha: "b2", at: "2026-07-02T00:00:00Z" }),
      ],
      releases: [],
      // Deliberately the OLDER one: a failed swap can leave the previous build
      // serving while the history already records the newer attempt.
      runningSha: "a1",
    });

    expect(candidates.find((c) => c.ref === "v1.0.0")?.running).toBe(true);
    expect(candidates.find((c) => c.ref === "v2.0.0")?.running).toBe(false);
  });

  it("falls back to the newest installed entry when the running SHA is unknown", () => {
    const candidates = buildVersionCandidates({
      history: [
        record({ ref: "v1.0.0", sha: "a1", at: "2026-07-01T00:00:00Z" }),
        record({ ref: "v2.0.0", sha: "b2", at: "2026-07-02T00:00:00Z" }),
      ],
      releases: [release("v3.0.0", "2026-07-03T00:00:00Z")],
      runningSha: undefined,
    });

    // v3.0.0 is newer but was never installed here, so it is not "running".
    expect(candidates.find((c) => c.ref === "v3.0.0")?.running).toBe(false);
    expect(candidates.find((c) => c.ref === "v2.0.0")?.running).toBe(true);
  });

  it("ignores a blank running SHA rather than matching a blank candidate", () => {
    const candidates = buildVersionCandidates({
      history: [record({ ref: "v1.0.0", sha: "a1" })],
      releases: [release("v2.0.0", "2026-07-10T00:00:00Z")],
      runningSha: "   ",
    });

    // The release has sha === null; a blank must not be treated as a match.
    expect(candidates.find((c) => c.ref === "v2.0.0")?.running).toBe(false);
    expect(candidates.find((c) => c.ref === "v1.0.0")?.running).toBe(true);
  });

  it("keeps a branch-mode deploy rollback-able via its commit", () => {
    const candidates = buildVersionCandidates({
      history: [record({ ref: null, sha: "deadbee", label: "Branch main" })],
      releases: [],
    });

    expect(candidates[0].ref).toBe("deadbee");
    expect(candidates[0].label).toBe("Branch main");
  });

  it("prefers the release name over the label recorded at deploy time", () => {
    const candidates = buildVersionCandidates({
      history: [record({ ref: "v2.0.0", label: "2.0.0 (v2.0.0)" })],
      releases: [release("v2.0.0", "2026-07-10T00:00:00Z")],
    });

    expect(candidates[0].label).toBe("2.0.0");
  });

  it("carries the pre-release flag so the UI can warn about beta targets", () => {
    const candidates = buildVersionCandidates({
      history: [],
      releases: [release("v3.0.0-beta.3", "2026-07-20T00:00:00Z", true)],
    });

    expect(candidates[0].preRelease).toBe(true);
  });

  it("returns an empty list when neither source has anything", () => {
    expect(buildVersionCandidates({ history: [], releases: [] })).toEqual([]);
  });
});

describe("allowedRollbackRefs", () => {
  it("excludes the running version and admits every other candidate", () => {
    const candidates = buildVersionCandidates({
      history: [
        record({ ref: "v1.0.0", sha: "a1", at: "2026-07-01T00:00:00Z" }),
        record({ ref: "v2.0.0", sha: "b2", at: "2026-07-02T00:00:00Z" }),
      ],
      releases: [],
      runningSha: "b2",
    });

    const allowed = allowedRollbackRefs(candidates);
    expect(allowed.has("v1.0.0")).toBe(true);
    expect(allowed.has("v2.0.0")).toBe(false);
  });

  it("admits nothing that was never offered — an arbitrary ref is not a version", () => {
    const allowed = allowedRollbackRefs(
      buildVersionCandidates({ history: [record({ ref: "v1.0.0" })], releases: [] }),
    );

    // This is the check that keeps the endpoint from building attacker-chosen code.
    expect(allowed.has("main")).toBe(false);
    expect(allowed.has("refs/pull/1/merge")).toBe(false);
    expect(allowed.has("../../etc")).toBe(false);
  });
});
