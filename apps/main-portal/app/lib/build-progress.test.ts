import { describe, expect, it } from "vitest";
import { parseBuildProgress } from "./build-progress";

describe("parseBuildProgress", () => {
  it("returns nothing for an empty or step-less log", () => {
    expect(parseBuildProgress("")).toEqual({ current: null, percent: null, summary: null });
    expect(parseBuildProgress("[update] building new image\n#1 DONE 0.1s").current).toBeNull();
  });

  it("reads the stage, index and total off a step line", () => {
    const progress = parseBuildProgress("#12 [builder 5/9] RUN pnpm install --frozen-lockfile");
    expect(progress.current).toEqual({
      stage: "builder",
      index: 5,
      total: 9,
      label: "RUN pnpm install --frozen-lockfile",
    });
    expect(progress.summary).toBe("builder 5/9");
  });

  it("tracks the furthest step per stage across interleaved output", () => {
    // BuildKit interleaves stages and repeats a step for its DONE line, so the
    // newest line is not necessarily the furthest one.
    const log = [
      "#10 [builder 2/9] COPY package.json ./",
      "#10 DONE 0.4s",
      "#12 [builder 5/9] RUN pnpm install",
      "#11 [runner 1/6] WORKDIR /app",
      "#12 DONE 41.3s",
    ].join("\n");

    const progress = parseBuildProgress(log);
    // builder reached 5/9, runner reached 1/6 → 6 of 15.
    expect(progress.percent).toBe(40);
  });

  it("ignores BuildKit's internal bookkeeping stages", () => {
    const log = [
      "#1 [internal] load build definition from Dockerfile",
      "#2 [internal 1/1] load .dockerignore",
      "#3 [builder 1/4] FROM node:22-alpine",
    ].join("\n");

    const progress = parseBuildProgress(log);
    expect(progress.current?.stage).toBe("builder");
    expect(progress.percent).toBe(25);
  });

  it("counts a CACHED step as reached", () => {
    const log = ["#17 [runner 3/6] COPY --from=builder /app ./", "#17 CACHED"].join("\n");
    expect(parseBuildProgress(log).percent).toBe(50);
  });

  it("rejects a malformed or out-of-range step rather than guessing", () => {
    expect(parseBuildProgress("#12 [builder 0/9] RUN x").current).toBeNull();
    expect(parseBuildProgress("#12 [builder 11/9] RUN x").current).toBeNull();
    expect(parseBuildProgress("#12 [builder 5/0] RUN x").current).toBeNull();
    expect(parseBuildProgress("#12 [builder abc] RUN x").current).toBeNull();
  });

  it("handles a stage name with spaces", () => {
    const progress = parseBuildProgress("#4 [linux/amd64 builder 2/8] RUN echo hi");
    expect(progress.current?.stage).toBe("linux/amd64 builder");
    expect(progress.current?.index).toBe(2);
  });

  it("never exceeds 100 percent", () => {
    const log = ["#1 [builder 9/9] RUN done", "#2 [runner 6/6] CMD start"].join("\n");
    expect(parseBuildProgress(log).percent).toBe(100);
  });

  it("survives the surrounding noise of a real log", () => {
    const log = [
      "===== update 2026-07-26T10:00:00Z =====",
      "[update] git checkout main + pull --ff-only",
      "[update] building new image",
      "#8 [builder 3/9] COPY . .",
      "#8 DONE 1.2s",
      " => => transferring context: 4.19MB",
    ].join("\n");

    expect(parseBuildProgress(log).summary).toBe("builder 3/9");
  });
});
