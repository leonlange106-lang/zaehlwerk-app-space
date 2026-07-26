import { describe, expect, it } from "vitest";
import { updateAvailableFor } from "./github";

// The rule that decides whether an instance is offered an update.
//
// Regression cover for the defect this replaced: the previous check compared the
// running build against the BRANCH HEAD for inequality, so an instance on the
// stable channel that had tested a beta saw the older stable release as "an
// update available" and would have installed it as one.

describe("updateAvailableFor", () => {
  it("offers an update when the release is a descendant of the running build", () => {
    expect(updateAvailableFor("ahead")).toBe(true);
  });

  it("does NOT offer an update when the running build is already newer", () => {
    // The everyday path here: test a beta, switch back to stable. Stable's
    // newest release is then an ANCESTOR of what is running — going to it is a
    // rollback, and the rollback UI is where that belongs.
    expect(updateAvailableFor("behind")).toBe(false);
  });

  it("does not offer an update for the same commit", () => {
    expect(updateAvailableFor("identical")).toBe(false);
  });

  it("offers a release on a diverged line — a published state outranks a local one", () => {
    expect(updateAvailableFor("diverged")).toBe(true);
  });
});
