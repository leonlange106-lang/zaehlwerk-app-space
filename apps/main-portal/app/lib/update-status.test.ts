import { describe, expect, it } from "vitest";
import {
  IDLE_UPDATE_STATE,
  normalizeUpdateState,
  UPDATE_STEPS,
  updateStateKey,
} from "./update-status";

describe("normalizeUpdateState — status mapping", () => {
  it("treats a missing status file as IDLE", () => {
    const s = normalizeUpdateState(null, "");
    expect(s.status).toBe("IDLE");
    expect(s.progress).toBe(0);
    expect(s.step).toBeNull();
    expect(s.error).toBeNull();
  });

  it("treats an explicit idle stage as IDLE", () => {
    expect(normalizeUpdateState({ stage: "idle" }).status).toBe("IDLE");
  });

  it("maps in-flight stages to RUNNING with the matching step", () => {
    const building = normalizeUpdateState({ stage: "building", message: "Neue Version wird gebaut" });
    expect(building.status).toBe("RUNNING");
    expect(building.stepIndex).toBe(1);
    expect(building.step).toBe(UPDATE_STEPS[1]);
    expect(building.message).toBe("Neue Version wird gebaut");
    expect(building.progress).toBeGreaterThan(0);
    expect(building.progress).toBeLessThan(100);
  });

  it("maps the done stage to SUCCESS at 100%", () => {
    const done = normalizeUpdateState({ stage: "done", done: true });
    expect(done.status).toBe("SUCCESS");
    expect(done.progress).toBe(100);
    expect(done.step).toBeNull();
    expect(done.error).toBeNull();
  });

  it("maps the failed stage to ERROR and surfaces the message", () => {
    const failed = normalizeUpdateState({ stage: "failed", message: "Build fehlgeschlagen" });
    expect(failed.status).toBe("ERROR");
    expect(failed.error).toBe("Build fehlgeschlagen");
  });

  it("falls back to a generic error message when none is given", () => {
    expect(normalizeUpdateState({ stage: "failed" }).error).toMatch(/fehlgeschlagen/i);
  });

  it("advances progress monotonically across the pipeline", () => {
    const order = ["started", "pulling", "building", "migrating", "restarting", "done"];
    const progresses = order.map((stage) => normalizeUpdateState({ stage }).progress);
    for (let i = 1; i < progresses.length; i += 1) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
    expect(progresses.at(-1)).toBe(100);
  });

  it("passes the log tail through untouched", () => {
    const s = normalizeUpdateState({ stage: "building" }, "line1\nline2\n");
    expect(s.logs).toBe("line1\nline2\n");
  });

  it("echoes the ordered step labels", () => {
    expect(normalizeUpdateState({ stage: "started" }).steps).toEqual([...UPDATE_STEPS]);
  });
});

describe("updateStateKey — change detection", () => {
  it("is stable for identical states", () => {
    const a = normalizeUpdateState({ stage: "building", updatedAt: "t1" }, "log");
    const b = normalizeUpdateState({ stage: "building", updatedAt: "t1" }, "log");
    expect(updateStateKey(a)).toBe(updateStateKey(b));
  });

  it("changes when the stage advances", () => {
    const a = normalizeUpdateState({ stage: "building", updatedAt: "t1" });
    const b = normalizeUpdateState({ stage: "migrating", updatedAt: "t2" });
    expect(updateStateKey(a)).not.toBe(updateStateKey(b));
  });

  it("changes when only the log grows (live log streaming)", () => {
    const a = normalizeUpdateState({ stage: "building", updatedAt: "t1" }, "one");
    const b = normalizeUpdateState({ stage: "building", updatedAt: "t1" }, "one-two");
    expect(updateStateKey(a)).not.toBe(updateStateKey(b));
  });

  it("the idle constant matches a freshly normalized idle state", () => {
    expect(updateStateKey(IDLE_UPDATE_STATE)).toBe(updateStateKey(normalizeUpdateState(null, "")));
  });
});

describe("rollback is not an update with a different name", () => {
  it("names the steps for what a rollback actually does", () => {
    // A rollback deliberately SKIPS the migration — `prisma db push` handed an
    // older schema wants to drop the newer version's columns. The stepper used
    // to tick off "Datenbank migriert" and show a green check for a step that
    // never ran, which is wrong about precisely the step people need to
    // understand before pressing the button.
    const rollback = normalizeUpdateState({ stage: "migrating", mode: "rollback" });
    expect(rollback.isRollback).toBe(true);
    expect(rollback.steps[2]).toBe("Datenbank bleibt unverändert");
    expect(rollback.step).toBe("Datenbank bleibt unverändert");
  });

  it("keeps the ordinary labels for a forward update", () => {
    const update = normalizeUpdateState({ stage: "migrating", mode: "update" });
    expect(update.isRollback).toBe(false);
    expect(update.steps).toEqual([...UPDATE_STEPS]);
    expect(update.step).toBe("Datenbank migriert");
  });

  it("treats a status file without a mode as a forward update", () => {
    // Written by a version that predates the field — it must not read as a
    // rollback, which is the more surprising of the two.
    const legacy = normalizeUpdateState({ stage: "building" });
    expect(legacy.isRollback).toBe(false);
    expect(legacy.steps).toEqual([...UPDATE_STEPS]);
  });

  it("keeps the same number of steps, so progress arithmetic is unchanged", () => {
    const a = normalizeUpdateState({ stage: "building", mode: "rollback" });
    const b = normalizeUpdateState({ stage: "building", mode: "update" });
    expect(a.steps).toHaveLength(b.steps.length);
    expect(a.progress).toBe(b.progress);
  });
});

describe("elapsed time", () => {
  it("is the difference between the file's own two timestamps", () => {
    // Measured from the STATUS FILE, never against the reader's clock: the
    // container is recreated mid-update and the browser may be in another
    // timezone or simply wrong. Both stamps come from the same `date -u`.
    const state = normalizeUpdateState({
      stage: "building",
      startedAt: "2026-07-26T12:00:00Z",
      updatedAt: "2026-07-26T12:04:12Z",
    });
    expect(state.elapsedSeconds).toBe(252);
    expect(state.startedAt).toBe("2026-07-26T12:00:00Z");
  });

  it("is null when the status file does not carry a start", () => {
    expect(normalizeUpdateState({ stage: "building", updatedAt: "2026-07-26T12:00:00Z" }).elapsedSeconds).toBeNull();
  });

  it("refuses a negative duration rather than showing one", () => {
    // A clock stepped backwards mid-run (NTP correcting a drifted host) would
    // otherwise render as "-3 min", which reads as a bug in the updater.
    const state = normalizeUpdateState({
      stage: "building",
      startedAt: "2026-07-26T12:05:00Z",
      updatedAt: "2026-07-26T12:00:00Z",
    });
    expect(state.elapsedSeconds).toBeNull();
  });

  it("survives an unparseable timestamp", () => {
    expect(
      normalizeUpdateState({ stage: "building", startedAt: "gestern", updatedAt: "heute" })
        .elapsedSeconds,
    ).toBeNull();
  });
});
