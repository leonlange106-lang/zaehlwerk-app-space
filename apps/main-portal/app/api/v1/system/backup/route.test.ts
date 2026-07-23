import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateApiRequest,
  recordAuditEvent,
  buildFullBackup,
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  readSnapshot,
  getBackupPolicy,
  markBackupRun,
} = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
  buildFullBackup: vi.fn(),
  createSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
  pruneSnapshots: vi.fn(),
  readSnapshot: vi.fn(),
  getBackupPolicy: vi.fn(),
  markBackupRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../../lib/api-auth", () => ({
  authenticateApiRequest,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));
vi.mock("../../../../lib/audit", () => ({
  AUDIT_ACTIONS: { backupCreate: "backup.create" },
  recordAuditEvent,
}));
vi.mock("../../../../lib/backup-engine", () => ({
  buildFullBackup,
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  readSnapshot,
}));
vi.mock("../../../../lib/settings", () => ({ getBackupPolicy, markBackupRun }));

import { GET, POST } from "./route";
import { __resetRateLimits, rateLimit } from "../../../../lib/rate-limit";

const admin = { id: "a1", email: "admin@b.de", role: "ADMIN" as const, via: "token" as const };
const normalUser = { id: "u1", email: "user@b.de", role: "USER" as const, via: "token" as const };

function request(url = "http://localhost/api/v1/system/backup", method = "GET"): Request {
  return new Request(url, { method });
}

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset();
  recordAuditEvent.mockClear();
  buildFullBackup.mockReset();
  createSnapshot.mockReset();
  listSnapshots.mockReset();
  pruneSnapshots.mockReset().mockResolvedValue(0);
  readSnapshot.mockReset();
  getBackupPolicy.mockReset().mockResolvedValue({ retentionDays: 30 });
  markBackupRun.mockClear();
});

describe("POST /api/v1/system/backup — access control (admin-only trigger)", () => {
  it("returns 401 when unauthenticated", async () => {
    authenticateApiRequest.mockResolvedValue(null);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin user", async () => {
    authenticateApiRequest.mockResolvedValue(normalUser);
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/system/backup — successful trigger + audit", () => {
  beforeEach(() => {
    authenticateApiRequest.mockResolvedValue(admin);
    createSnapshot.mockResolvedValue({
      jsonName: "snap.json",
      sqliteName: "snap.sqlite",
      totalBytes: 4096,
    });
    pruneSnapshots.mockResolvedValue(2);
  });

  it("creates a snapshot, prunes, and returns 201", async () => {
    const res = await POST(request());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, json: "snap.json", sqlite: "snap.sqlite", pruned: 2 });
    expect(createSnapshot).toHaveBeenCalledOnce();
    expect(markBackupRun).toHaveBeenCalledOnce();
  });

  it("records a backup.create audit event (audit integration)", async () => {
    await POST(request());
    expect(recordAuditEvent).toHaveBeenCalledOnce();
    const [action, actor] = recordAuditEvent.mock.calls[0];
    expect(action).toBe("backup.create");
    expect(actor).toContain("admin@b.de");
  });

  it("returns 500 (and no audit) when the snapshot fails", async () => {
    createSnapshot.mockRejectedValue(new Error("disk full"));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/system/backup — rate limiting", () => {
  it("returns 429 after the trigger window is exhausted", async () => {
    authenticateApiRequest.mockResolvedValue(admin);
    for (let i = 0; i < 6; i += 1) {
      rateLimit({ key: "backup:unknown", limit: 6, windowMs: 60_000 });
    }
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(authenticateApiRequest).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/system/backup — reads", () => {
  it("returns 401 when unauthenticated", async () => {
    authenticateApiRequest.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });

  it("streams a fresh full backup for any authenticated user", async () => {
    authenticateApiRequest.mockResolvedValue(normalUser);
    buildFullBackup.mockResolvedValue({ generatedAt: "2024-02-01T10:00:00Z", data: [] });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("zaehlwerk_backup_2024-02-01");
  });

  it("forbids a non-admin from listing persisted snapshots", async () => {
    authenticateApiRequest.mockResolvedValue(normalUser);
    const res = await GET(request("http://localhost/api/v1/system/backup?list=1"));
    expect(res.status).toBe(403);
    expect(listSnapshots).not.toHaveBeenCalled();
  });

  it("lets an admin list snapshots", async () => {
    authenticateApiRequest.mockResolvedValue(admin);
    listSnapshots.mockResolvedValue([{ name: "snap.json" }]);
    const res = await GET(request("http://localhost/api/v1/system/backup?list=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.snapshots).toHaveLength(1);
  });

  it("forbids a non-admin from downloading a snapshot file", async () => {
    authenticateApiRequest.mockResolvedValue(normalUser);
    const res = await GET(request("http://localhost/api/v1/system/backup?file=snap.json"));
    expect(res.status).toBe(403);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});
