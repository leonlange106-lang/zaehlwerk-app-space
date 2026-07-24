import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update } = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@zaehlwerk/database", () => ({
  prisma: { ingestionKey: { findUnique, update } },
}));

import { authenticateIngestion, extractIngestionKey } from "./ingestion-auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/logs/ingest", { method: "POST", headers });
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset().mockResolvedValue({});
  delete process.env.INGESTION_API_KEY;
});
afterEach(() => {
  delete process.env.INGESTION_API_KEY;
});

describe("extractIngestionKey", () => {
  it("reads the X-API-Key header", () => {
    expect(extractIngestionKey(req({ "x-api-key": "abc" }))).toBe("abc");
  });
  it("reads a Bearer Authorization header", () => {
    expect(extractIngestionKey(req({ authorization: "Bearer xyz" }))).toBe("xyz");
  });
  it("returns null when no key is present", () => {
    expect(extractIngestionKey(req({}))).toBeNull();
  });
});

describe("authenticateIngestion", () => {
  it("returns null without a key", async () => {
    expect(await authenticateIngestion(req({}))).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("accepts the env bootstrap key via constant-time compare", async () => {
    process.env.INGESTION_API_KEY = "boot-secret";
    const principal = await authenticateIngestion(req({ "x-api-key": "boot-secret" }));
    expect(principal).toMatchObject({ via: "env" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a wrong env key and falls through to the DB (miss → null)", async () => {
    process.env.INGESTION_API_KEY = "boot-secret";
    findUnique.mockResolvedValue(null);
    expect(await authenticateIngestion(req({ "x-api-key": "nope" }))).toBeNull();
    expect(findUnique).toHaveBeenCalled();
  });

  it("accepts a valid DB key and stamps lastUsedAt", async () => {
    findUnique.mockResolvedValue({ id: "k1", name: "HA", revoked: false, expiresAt: null });
    const principal = await authenticateIngestion(req({ "x-api-key": "zw_ing_valid" }));
    expect(principal).toMatchObject({ id: "k1", name: "HA", via: "key" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "k1" } }));
  });

  it("rejects a revoked key", async () => {
    findUnique.mockResolvedValue({ id: "k1", name: "HA", revoked: true, expiresAt: null });
    expect(await authenticateIngestion(req({ "x-api-key": "zw_ing_x" }))).toBeNull();
  });

  it("rejects an expired key", async () => {
    findUnique.mockResolvedValue({ id: "k1", name: "HA", revoked: false, expiresAt: new Date(Date.now() - 1000) });
    expect(await authenticateIngestion(req({ "x-api-key": "zw_ing_x" }))).toBeNull();
  });
});
