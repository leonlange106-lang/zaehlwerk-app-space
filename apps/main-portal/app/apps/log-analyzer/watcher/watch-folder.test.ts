import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveInto, processWatchFile, scanOnce, type WatchDeps } from "./watch-folder";
import type { WatchConfig } from "./config";

let root: string;
let config: WatchConfig;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "watch-"));
  config = {
    dir: root,
    processedDir: path.join(root, "processed"),
    failedDir: path.join(root, "failed"),
    pollMs: 10,
    settleMs: 1000,
  };
  await mkdir(config.processedDir, { recursive: true });
  await mkdir(config.failedDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const okIngest = (): WatchDeps => ({
  ingest: vi.fn().mockResolvedValue({
    duplicate: false,
    log: { id: "log-1", name: "x", status: "verified", health: "safe" },
    ingestStatus: "VERIFIED",
  }),
});

describe("moveInto", () => {
  it("moves a file into the destination directory", async () => {
    const src = path.join(root, "a.csv");
    await writeFile(src, "hi");
    const dest = await moveInto(src, config.processedDir);
    expect(dest).toBe(path.join(config.processedDir, "a.csv"));
    expect(await readdir(config.processedDir)).toEqual(["a.csv"]);
    expect(await readdir(root)).not.toContain("a.csv");
  });

  it("avoids overwriting on a name collision", async () => {
    await writeFile(path.join(config.processedDir, "a.csv"), "old");
    const src = path.join(root, "a.csv");
    await writeFile(src, "new");
    const dest = await moveInto(src, config.processedDir);
    expect(path.basename(dest)).not.toBe("a.csv");
    expect((await readdir(config.processedDir)).length).toBe(2);
  });
});

describe("processWatchFile", () => {
  it("imports a CSV and moves it to /processed", async () => {
    const deps = okIngest();
    const src = path.join(root, "pull.csv");
    await writeFile(src, "Time (s),RPM\n0,1000\n1,5000");
    const result = await processWatchFile(src, config, deps);
    expect(result.outcome).toBe("processed");
    expect(deps.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pull.csv", source: "watch" }),
    );
    expect(await readdir(config.processedDir)).toContain("pull.csv");
  });

  it("moves a file to /failed when ingestion throws", async () => {
    const deps: WatchDeps = { ingest: vi.fn().mockRejectedValue(new Error("bad")) };
    const src = path.join(root, "broken.csv");
    await writeFile(src, "garbage");
    const result = await processWatchFile(src, config, deps);
    expect(result.outcome).toBe("failed");
    expect(await readdir(config.failedDir)).toContain("broken.csv");
  });

  it("treats an empty file as a failure", async () => {
    const deps = okIngest();
    const src = path.join(root, "empty.csv");
    await writeFile(src, "   ");
    const result = await processWatchFile(src, config, deps);
    expect(result.outcome).toBe("failed");
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(await readdir(config.failedDir)).toContain("empty.csv");
  });
});

describe("scanOnce — stability / debounce", () => {
  it("does not import a file until it has settled", async () => {
    const deps = okIngest();
    const pending = new Map();
    const inFlight = new Set<string>();
    await writeFile(path.join(root, "new.csv"), "data");
    // First sight at t=0 → tracked, not imported.
    await scanOnce(config, pending, inFlight, deps, 0);
    expect(deps.ingest).not.toHaveBeenCalled();
    // Still within the settle window → still not imported.
    await scanOnce(config, pending, inFlight, deps, 500);
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it("imports a file once it is stable past settleMs", async () => {
    const deps = okIngest();
    const pending = new Map();
    const inFlight = new Set<string>();
    await writeFile(path.join(root, "ready.csv"), "data");
    await scanOnce(config, pending, inFlight, deps, 0); // first sight
    await scanOnce(config, pending, inFlight, deps, 2000); // settled → import
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(await readdir(config.processedDir)).toContain("ready.csv");
  });

  it("ignores non-CSV files", async () => {
    const deps = okIngest();
    await writeFile(path.join(root, "notes.txt"), "hi");
    await scanOnce(config, new Map(), new Set(), deps, 0);
    await scanOnce(config, new Map(), new Set(), deps, 5000);
    expect(deps.ingest).not.toHaveBeenCalled();
  });
});
