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
