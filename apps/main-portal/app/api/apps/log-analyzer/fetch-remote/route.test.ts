import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth + app-access are mocked so we can drive authorization outcomes directly;
// the URL validation and CSV parsing stay REAL so the route's guardrails and
// happy path are exercised end-to-end against a mocked upstream fetch.
const { authenticateApiRequest, allowedAppIdsFor } = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  allowedAppIdsFor: vi.fn(),
}));

vi.mock("@/app/lib/api-auth", () => ({
  authenticateApiRequest,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));
vi.mock("@/app/lib/app-access", () => ({ allowedAppIdsFor }));

import { POST } from "./route";
import { __resetRateLimits, rateLimit } from "@/app/lib/rate-limit";

const VALID_URL = "https://logs.mgflasher.com/log/0f8fad5b-d9cb-469f-a165-70867728950e";

const CSV = [
  "# VIN: WBSSYNTH0TEST1234",
  "Time (s),RPM,Boost Actual (psi)",
  "0,1000,1.0",
  "1,5000,12.0",
].join("\n");

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/apps/log-analyzer/fetch-remote", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function fetchOk(text: string, init: ResponseInit = {}): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/csv" }, ...init });
}

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset().mockResolvedValue({ id: "u1", email: "a@b.de", role: "USER", via: "session" });
  allowedAppIdsFor.mockReset().mockResolvedValue(["log-analyzer"]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchOk(CSV)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST fetch-remote — access control", () => {
  it("401 when unauthenticated", async () => {
    authenticateApiRequest.mockResolvedValue(null);
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("403 when the user lacks the log-analyzer app", async () => {
    allowedAppIdsFor.mockResolvedValue(["zaehlwerk"]);
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST fetch-remote — URL validation (SSRF guard)", () => {
  it("400 for a foreign host without ever fetching", async () => {
    const res = await POST(post({ url: "https://evil.example.com/log/0f8fad5b-d9cb-469f-a165-70867728950e" }));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("400 for a missing/blank url", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("400 for a non-JSON body", async () => {
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
  });

  it("only ever fetches the allowed host over https", async () => {
    await POST(post({ url: VALID_URL }));
    expect(fetch).toHaveBeenCalledTimes(1);
    const target = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(target.startsWith("https://logs.mgflasher.com/")).toBe(true);
  });
});

describe("POST fetch-remote — upstream error mapping", () => {
  it("404 when the log does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(404);
  });

  it("429 when the upstream rate-limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(429);
  });

  it("502 on a generic upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(502);
  });

  it("502 when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(502);
  });

  it("504 when the fetch is aborted (timeout)", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(504);
  });

  it("422 when the payload is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchOk("   ")));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(422);
  });

  it("422 when the CSV has no usable data rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchOk("Time,RPM\n")));
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(422);
  });
});

describe("POST fetch-remote — happy path", () => {
  it("200 with a structured, parsed log", async () => {
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.source).toBe(VALID_URL);
    expect(json.log.rowCount).toBe(2);
    expect(json.log.meta.vin).toBe("WBSSYNTH0TEST1234");
    expect(json.log.series.map((s: { label: string }) => s.label)).toContain("RPM");
  });
});

describe("POST fetch-remote — rate limiting", () => {
  it("429 once the per-IP window is exhausted, before auth/fetch", async () => {
    for (let i = 0; i < 20; i += 1) {
      rateLimit({ key: "log-analyzer:fetch:unknown", limit: 20, windowMs: 60_000 });
    }
    const res = await POST(post({ url: VALID_URL }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(authenticateApiRequest).not.toHaveBeenCalled();
  });
});
