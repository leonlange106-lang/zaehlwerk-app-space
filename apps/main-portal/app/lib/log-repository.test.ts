import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSampleCsv } from "../apps/log-analyzer/lib/sample-log";

// Mock the Prisma client: capture what the repository persists, and echo it back
// (with generated id/createdAt) so we can assert the derived status/meta + tag
// handling without a real database.
const { create, findMany, findUnique, update, del, deleteMany } = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock("@zaehlwerk/database", () => ({
  prisma: { logFile: { create, findMany, findUnique, update, delete: del, deleteMany } },
}));

import { createLogs, listLogs, pruneLogs, updateLogTags } from "./log-repository";
import { EVALUATION_VERSION } from "../apps/log-analyzer/lib/evaluation-version";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    name: "n",
    source: "upload",
    sourceUrl: null,
    csv: "",
    rowCount: 0,
    vin: null,
    vehicle: null,
    mapVersion: null,
    software: null,
    loggedAt: null,
    status: "invalid",
    health: "safe",
    recordedAt: null,
    octane: null,
    tags: "",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  create.mockReset();
  findMany.mockReset();
  update.mockReset();
  deleteMany.mockReset();
});

describe("createLogs — parse, evaluate & persist", () => {
  it("derives a VERIFIED status and header meta from a clean sample log", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, id: "log-1" }),
    );
    const [summary] = await createLogs([{ name: "sample.csv", csv: makeSampleCsv() }]);

    const persisted = create.mock.calls[0][0].data;
    expect(persisted.status).toBe("verified");
    expect(persisted.rowCount).toBeGreaterThan(0);
    expect(persisted.vin).toMatch(/SYNTH/i);
    expect(summary.status).toBe("verified");
    expect(summary.tags).toEqual([]);
  });

  it("stores an INVALID status for an unparseable file rather than throwing", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));
    const [summary] = await createLogs([{ name: "junk.csv", csv: "not,a,valid\nlog" }]);
    expect(summary.status).toBe("invalid");
    expect(summary.rowCount).toBe(0);
  });

  it("pre-fills recordedAt and octane from the filename timestamp", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));
    await createLogs([
      { name: "2026-07-20_22_37_14_Stage1_100RON_CS1.csv", csv: makeSampleCsv() },
    ]);
    const persisted = create.mock.calls[0][0].data;
    expect((persisted.recordedAt as Date).toISOString()).toBe("2026-07-20T22:37:14.000Z");
    expect(persisted.octane).toBe("100 RON");
  });

  it("persists each file of a bulk upload", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));
    const created = await createLogs([
      { name: "a.csv", csv: makeSampleCsv() },
      { name: "b.csv", csv: makeSampleCsv() },
    ]);
    expect(created).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("live re-evaluation on read (dynamic health/status tags)", () => {
  it("re-derives status/health from the stored CSV, ignoring stale persisted values", async () => {
    // Persisted columns say invalid/danger and carry no evaluation version, so
    // the row is stale: the overview must reflect the CURRENT evaluation, not
    // the frozen import.
    findMany.mockResolvedValue([
      row({ csv: makeSampleCsv(), status: "invalid", health: "danger" }),
    ]);
    const [s] = await listLogs();
    expect(s.status).toBe("verified");
    expect(s.health).toBe("safe");
  });

  it("falls back to the persisted values when the stored CSV can't be parsed", async () => {
    findMany.mockResolvedValue([row({ csv: "", status: "partial", health: "caution" })]);
    const [s] = await listLogs();
    expect(s.status).toBe("partial");
    expect(s.health).toBe("caution");
  });

  it("writes the fresh verdict back so the re-parse happens only once", async () => {
    findMany.mockResolvedValue([
      row({ csv: makeSampleCsv(), status: "invalid", health: "danger" }),
    ]);
    await listLogs();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({
      status: "verified",
      health: "safe",
      evalVersion: EVALUATION_VERSION,
    });
  });
});

describe("cached verdicts (the hot path)", () => {
  it("serves rows already on the current evaluation version without touching the CSV", async () => {
    // A row scored under the current version is trusted as-is. The point of the
    // cache is that listing never loads the (very large) csv column, so the
    // second findMany that fetches CSVs for stale rows must not happen at all.
    findMany.mockResolvedValue([
      row({ status: "partial", health: "caution", evalVersion: EVALUATION_VERSION }),
    ]);

    const [s] = await listLogs();

    expect(s.status).toBe("partial");
    expect(s.health).toBe("caution");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not select the csv column when listing", async () => {
    findMany.mockResolvedValue([row({ evalVersion: EVALUATION_VERSION })]);
    await listLogs();
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("csv");
  });

  it("re-scores only the rows left stale by a version change", async () => {
    findMany.mockResolvedValue([
      row({ id: "fresh", evalVersion: EVALUATION_VERSION, status: "partial" }),
      row({ id: "stale", evalVersion: "0-deadbeef", csv: makeSampleCsv(), status: "invalid" }),
    ]);

    const summaries = await listLogs();

    expect(summaries.find((s) => s.id === "fresh")!.status).toBe("partial");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: "stale" });
  });
});

describe("pruneLogs — retention", () => {
  it("does nothing at all when both limits are disabled", async () => {
    const result = await pruneLogs({ retentionDays: 0, maxCount: 0 });
    expect(result.deleted).toBe(0);
    // Crucially it must not even query: retention is opt-in, and a no-op policy
    // may never touch stored logs.
    expect(deleteMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("deletes logs older than the retention cutoff", async () => {
    deleteMany.mockResolvedValue({ count: 3 });
    const result = await pruneLogs({ retentionDays: 30, maxCount: 0 });

    expect(result.deleted).toBe(3);
    const where = deleteMany.mock.calls[0][0].where;
    const cutoff = where.createdAt.lt as Date;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
  });

  it("keeps only the newest N when a count cap is set", async () => {
    findMany.mockResolvedValue([{ id: "old-1" }, { id: "old-2" }]);
    deleteMany.mockResolvedValue({ count: 2 });

    const result = await pruneLogs({ retentionDays: 0, maxCount: 50 });

    expect(result.deleted).toBe(2);
    expect(findMany.mock.calls[0][0].skip).toBe(50);
    expect(deleteMany.mock.calls[0][0].where).toEqual({ id: { in: ["old-1", "old-2"] } });
  });

  it("skips the delete entirely when nothing exceeds the cap", async () => {
    findMany.mockResolvedValue([]);
    const result = await pruneLogs({ retentionDays: 0, maxCount: 10 });
    expect(result.deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("applies both limits together", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([{ id: "over" }]);

    const result = await pruneLogs({ retentionDays: 7, maxCount: 5 });

    expect(result.deleted).toBe(2); // one by age + one by cap
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});

describe("summary mapping & tag updates", () => {
  it("splits the stored comma tag string into an array", async () => {
    findMany.mockResolvedValue([row({ tags: "map1, 100 RON , dyno" })]);
    const [s] = await listLogs();
    expect(s.tags).toEqual(["map1", "100 RON", "dyno"]);
  });

  it("joins a tags array back into the stored string on update", async () => {
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ tags: data.tags as string, octane: data.octane as string }),
    );
    await updateLogTags("log-1", { octane: "E85", tags: ["street", "pull"] });
    const data = update.mock.calls[0][0].data;
    expect(data.tags).toBe("street, pull");
    expect(data.octane).toBe("E85");
  });
});
