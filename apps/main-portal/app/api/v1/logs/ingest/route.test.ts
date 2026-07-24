import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth + the ingestion service are mocked so we can drive outcomes directly; the
// route's payload handling (raw + multipart), param plumbing and status mapping
// stay REAL and are exercised end-to-end.
const { authenticateIngestion, ingestCsv } = vi.hoisted(() => ({
  authenticateIngestion: vi.fn(),
  ingestCsv: vi.fn(),
}));

vi.mock("@/app/lib/ingestion-auth", () => ({
  authenticateIngestion,
  ingestionUnauthorized: () =>
    new Response(JSON.stringify({ success: false, error: "Ungültiger oder fehlender API-Key." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));
vi.mock("@/app/lib/log-ingest", () => ({ ingestCsv }));
vi.mock("@/app/lib/audit", () => ({
  AUDIT_ACTIONS: { logIngest: "loganalyzer.ingest" },
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";
import { __resetRateLimits } from "@/app/lib/rate-limit";

const CSV = ["Time (s),RPM,Pedal (%)", "0,1000,40", "1,5000,100"].join("\n");

function rawPost(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/logs/ingest", {
    method: "POST",
    body,
    headers: { "content-type": "text/csv", "x-api-key": "valid", ...headers },
  });
}

const OK_RESULT = {
  duplicate: false,
  log: { id: "log-1", name: "pull.csv", status: "verified", health: "safe" },
  ingestStatus: "VERIFIED",
};

beforeEach(() => {
  __resetRateLimits();
  authenticateIngestion.mockReset().mockResolvedValue({ id: "k1", name: "HA", via: "key" });
  ingestCsv.mockReset().mockResolvedValue(OK_RESULT);
});

describe("POST /api/v1/logs/ingest — auth", () => {
  it("401s with an invalid/missing key", async () => {
    authenticateIngestion.mockResolvedValue(null);
    const res = await POST(rawPost(CSV, { "x-api-key": "" }));
    expect(res.status).toBe(401);
    expect(ingestCsv).not.toHaveBeenCalled();
  });

  it("accepts a valid key and returns the ingestion status", async () => {
    const res = await POST(rawPost(CSV));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, logId: "log-1", status: "VERIFIED", duplicate: false });
    expect(ingestCsv).toHaveBeenCalledWith(expect.objectContaining({ source: "ingest", csv: CSV }));
  });
});

describe("POST /api/v1/logs/ingest — payloads & params", () => {
  it("reads a raw text/csv body and takes the name from ?name / X-Filename", async () => {
    await POST(rawPost(CSV, { "x-filename": "drive.csv" }));
    expect(ingestCsv).toHaveBeenCalledWith(expect.objectContaining({ name: "drive.csv" }));
  });

  it("threads profileId / notes / vehicle from the query string", async () => {
    const req = new NextRequest("http://localhost/api/v1/logs/ingest?profileId=p1&notes=track&vehicle=M2", {
      method: "POST",
      body: CSV,
      headers: { "content-type": "text/csv", "x-api-key": "valid" },
    });
    await POST(req);
    expect(ingestCsv).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "p1", notes: "track", vehicle: "M2" }),
    );
  });

  it("accepts a multipart/form-data file upload", async () => {
    const form = new FormData();
    form.append("file", new File([CSV], "form.csv", { type: "text/csv" }));
    form.append("notes", "via-form");
    const req = new NextRequest("http://localhost/api/v1/logs/ingest", {
      method: "POST",
      body: form,
      headers: { "x-api-key": "valid" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(ingestCsv).toHaveBeenCalledWith(
      expect.objectContaining({ name: "form.csv", csv: CSV, notes: "via-form", source: "ingest" }),
    );
  });

  it("400s on an empty body", async () => {
    const res = await POST(rawPost("   "));
    expect(res.status).toBe(400);
    expect(ingestCsv).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/logs/ingest — deduplication", () => {
  it("reports a duplicate (200) without creating a second log", async () => {
    ingestCsv.mockResolvedValue({ ...OK_RESULT, duplicate: true });
    const res = await POST(rawPost(CSV));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, duplicate: true, logId: "log-1", status: "VERIFIED" });
  });
});
