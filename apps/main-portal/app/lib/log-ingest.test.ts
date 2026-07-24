import { beforeEach, describe, expect, it, vi } from "vitest";

const { createLogs, findLogByContentHash, broadcastLogIngested } = vi.hoisted(() => ({
  createLogs: vi.fn(),
  findLogByContentHash: vi.fn(),
  broadcastLogIngested: vi.fn(),
}));

vi.mock("./log-repository", () => ({ createLogs, findLogByContentHash }));
vi.mock("./log-events", () => ({ broadcastLogIngested }));

import { ingestCsv } from "./log-ingest";

const summary = { id: "log-1", name: "pull.csv", status: "verified", health: "safe" };

beforeEach(() => {
  createLogs.mockReset().mockResolvedValue([summary]);
  findLogByContentHash.mockReset().mockResolvedValue(null);
  broadcastLogIngested.mockReset();
});

describe("ingestCsv", () => {
  it("creates a new log, maps the status and broadcasts", async () => {
    const result = await ingestCsv({ name: "pull.csv", csv: "a,b\n1,2", source: "ingest" });
    expect(result.duplicate).toBe(false);
    expect(result.ingestStatus).toBe("VERIFIED");
    expect(createLogs).toHaveBeenCalledTimes(1);
    expect(broadcastLogIngested).toHaveBeenCalledWith(
      expect.objectContaining({ id: "log-1", ingestStatus: "VERIFIED", duplicate: false }),
    );
  });

  it("short-circuits a duplicate by content hash without creating a second log", async () => {
    findLogByContentHash.mockResolvedValue(summary);
    const result = await ingestCsv({ name: "pull.csv", csv: "a,b\n1,2", source: "watch" });
    expect(result.duplicate).toBe(true);
    expect(createLogs).not.toHaveBeenCalled();
    expect(broadcastLogIngested).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
  });

  it("folds profileId into the stored note and passes an explicit vehicle", async () => {
    await ingestCsv({ name: "x.csv", csv: "a\n1", source: "ingest", profileId: "p9", notes: "n", vehicle: "M2" });
    expect(createLogs).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle: "M2", notes: "profileId=p9 · n" }),
    ]);
  });
});
