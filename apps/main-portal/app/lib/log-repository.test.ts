import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSampleCsv } from "../apps/log-analyzer/lib/sample-log";

// Mock the Prisma client: capture what the repository persists, and echo it back
// (with generated id/createdAt) so we can assert the derived status/meta + tag
// handling without a real database.
const {
  count,
  create,
  findMany,
  findUnique,
  update,
  del,
  deleteMany,
  vehicleFindFirst,
  vehicleFindUnique,
} = vi.hoisted(() => ({
  // `listLogs` fragt die Gesamtzahl mit ab — eine abgeschnittene Liste ohne
  // diese Angabe saehe aus wie der ganze Bestand.
  count: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  deleteMany: vi.fn(),
  // A log is judged by the vehicle it is pinned to, so the mock has to answer
  // for `vehicle` as well. Default is "no vehicle" — the default spec.
  vehicleFindFirst: vi.fn(),
  vehicleFindUnique: vi.fn(),
}));
vi.mock("@zaehlwerk/database", () => ({
  prisma: {
    logFile: { create, findMany, findUnique, update, delete: del, deleteMany, count },
    vehicle: { findFirst: vehicleFindFirst, findUnique: vehicleFindUnique },
  },
}));

import { createLogs, listLogs, pruneLogs, updateLogTags } from "./log-repository";
import { EVALUATION_VERSION } from "../apps/log-analyzer/lib/evaluation-version";

/** A stored vehicle row as Prisma hands it back, with an optional limit patch. */
function vehicleRow(limitOverrides: Record<string, number> = {}) {
  return {
    id: "veh-1",
    name: "Testwagen",
    active: true,
    brand: null,
    series: null,
    vehicleModel: null,
    engineCode: "n54",
    transmission: "manual",
    catType: "oem",
    fuel: "pump",
    turbo: "stock",
    hpfp: "stock",
    stage: "stage1",
    limitOverrides: JSON.stringify(limitOverrides),
    dynoProfile: null,
    profileOrigin: "own",
    createdAt: new Date("2026-07-01T00:00:00Z"),
  };
}

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
  // Standard: so viele Zeilen wie geliefert. Tests, die das Blaettern selbst
  // pruefen, setzen es abweichend.
  count.mockReset().mockImplementation(async () => {
    const rows = await findMany.mock.results[0]?.value;
    return Array.isArray(rows) ? rows.length : 0;
  });
  update.mockReset();
  deleteMany.mockReset();
  vehicleFindFirst.mockReset();
  vehicleFindUnique.mockReset();
  vehicleFindFirst.mockResolvedValue(null);
  vehicleFindUnique.mockResolvedValue(null);
});

// The chain these cover was fully built and fully disconnected: `vehicleId` was
// never written, `getActiveVehicle()` had no callers, and the repository scored
// everything against DEFAULT_VEHICLE_SPEC. A vehicle someone maintained changed
// no verdict at all, and no test noticed — because none asserted that it should.
describe("createLogs — the vehicle a log is judged by", () => {
  it("pins the active vehicle onto the row", async () => {
    vehicleFindFirst.mockResolvedValue(vehicleRow());
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));

    await createLogs([{ name: "sample.csv", csv: makeSampleCsv() }]);

    expect(create.mock.calls[0][0].data.vehicleId).toBe("veh-1");
  });

  it("scores against the vehicle's OWN limits, not the derived ones", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));

    // The SAME vehicle twice, differing only in the override. Comparing against
    // the default fingerprint would prove nothing — this spec is not the default
    // one, so its version differs either way. Only holding the spec fixed
    // isolates the question actually being asked: do the user's own limits reach
    // the engine? While they did not, both runs produced the same string.
    vehicleFindFirst.mockResolvedValue(vehicleRow());
    await createLogs([{ name: "sample.csv", csv: makeSampleCsv() }]);
    const derived = create.mock.calls[0][0].data.evalVersion;

    create.mockClear();
    vehicleFindFirst.mockResolvedValue(vehicleRow({ maxEgt: 1099 }));
    await createLogs([{ name: "sample.csv", csv: makeSampleCsv() }]);
    const patched = create.mock.calls[0][0].data.evalVersion;

    expect(patched).not.toBe(derived);
  });

  it("keeps the default fingerprint when there is no vehicle", async () => {
    // Load-bearing for existing installations: wiring vehicles up must not
    // invalidate a single already-scored row, so a log without a vehicle has to
    // keep exactly the version string the old constant produced.
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));

    await createLogs([{ name: "sample.csv", csv: makeSampleCsv() }]);

    const persisted = create.mock.calls[0][0].data;
    expect(persisted.evalVersion).toBe(EVALUATION_VERSION);
    expect(persisted.vehicleId).toBeNull();
  });
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
    const [s] = (await listLogs()).logs;
    expect(s.status).toBe("verified");
    expect(s.health).toBe("safe");
  });

  it("falls back to the persisted values when the stored CSV can't be parsed", async () => {
    findMany.mockResolvedValue([row({ csv: "", status: "partial", health: "caution" })]);
    const [s] = (await listLogs()).logs;
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

    const [s] = (await listLogs()).logs;

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

    const summaries = (await listLogs()).logs;

    expect(summaries.find((s) => s.id === "fresh")!.status).toBe("partial");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: "stale" });
  });
});

describe("listLogs — Blaettern (QLT-01)", () => {
  it("holt nicht mehr den ganzen Bestand", async () => {
    // Vorher holte diese Abfrage JEDE Zeile — und `refreshStaleVerdicts`
    // bewertete anschliessend jede davon neu, samt CSV. Bei ein paar Dutzend
    // Logs faellt das nicht auf; bei ein paar Tausend beschaeftigt es den
    // Server sekundenlang. Die Grenze fehlte schlicht.
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listLogs();

    expect(findMany.mock.calls[0][0].take).toBe(200);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("meldet die Gesamtzahl mit", async () => {
    // Eine abgeschnittene Liste ohne diese Angabe sieht aus wie der ganze
    // Bestand.
    findMany.mockResolvedValue([row({ id: "a" })]);
    count.mockResolvedValue(1500);

    const result = await listLogs({ limit: 1 });

    expect(result.total).toBe(1500);
    expect(result.hasMore).toBe(true);
  });

  it("meldet hasMore=false auf der letzten Seite", async () => {
    findMany.mockResolvedValue([row({ id: "a" })]);
    count.mockResolvedValue(11);

    const result = await listLogs({ limit: 1, offset: 10 });

    expect(result.hasMore).toBe(false);
  });

  it("deckelt eine unsinnige Seitengroesse, statt sie zu uebernehmen", async () => {
    // `?limit=100000` waere sonst genau der Zustand, den dieses Item beseitigt.
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listLogs({ limit: 100_000 });
    expect(findMany.mock.calls[0][0].take).toBe(500);

    findMany.mockClear();
    await listLogs({ limit: 0, offset: -5 });
    expect(findMany.mock.calls[0][0].take).toBe(1);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("bewertet nur die Zeilen DIESER Seite neu", async () => {
    // Genau hier lag der Aufwand: Die Neubewertung liest je Zeile das CSV.
    findMany.mockResolvedValue([
      row({ id: "stale", evalVersion: "0-deadbeef", csv: makeSampleCsv(), status: "invalid" }),
    ]);
    count.mockResolvedValue(5000);

    await listLogs({ limit: 1 });

    expect(update).toHaveBeenCalledTimes(1);
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
    const [s] = (await listLogs()).logs;
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
