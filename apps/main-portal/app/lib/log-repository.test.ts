import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSampleCsv } from "../apps/log-analyzer/lib/sample-log";

// Mock the Prisma client: capture what the repository persists, and echo it back
// (with generated id/createdAt) so we can assert the derived status/meta + tag
// handling without a real database.
const { create, findMany, findUnique, update, del } = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@zaehlwerk/database", () => ({
  prisma: { logFile: { create, findMany, findUnique, update, delete: del } },
}));

import { createLogs, listLogs, updateLogTags } from "./log-repository";

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
