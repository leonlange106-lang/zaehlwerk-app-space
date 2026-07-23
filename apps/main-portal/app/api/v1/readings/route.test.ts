import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth is mocked so we can drive the authorization outcome directly; the Zod
// schema and consumption math stay REAL (imported from the shared entry) so the
// route's validation and plausibility logic are exercised for real.
const { authenticateApiRequest, zaehlerFindUnique, ablesungFindMany, ablesungCreate } = vi.hoisted(
  () => ({
    authenticateApiRequest: vi.fn(),
    zaehlerFindUnique: vi.fn(),
    ablesungFindMany: vi.fn(),
    ablesungCreate: vi.fn(),
  }),
);
vi.mock("../../../lib/api-auth", () => ({
  authenticateApiRequest,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@zaehlwerk/database", async () => {
  const shared =
    await vi.importActual<typeof import("@zaehlwerk/database/shared")>("@zaehlwerk/database/shared");
  return {
    ...shared,
    prisma: {
      zaehler: { findUnique: zaehlerFindUnique },
      ablesung: { findMany: ablesungFindMany, create: ablesungCreate },
    },
  };
});

import { POST } from "./route";
import { __resetRateLimits, rateLimit } from "../../../lib/rate-limit";

const METER = "22222222-2222-4222-8222-222222222222";

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/readings", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset();
  zaehlerFindUnique.mockReset();
  ablesungFindMany.mockReset().mockResolvedValue([]);
  ablesungCreate.mockReset();
  authenticateApiRequest.mockResolvedValue({ id: "u1", email: "dev@b.de", role: "USER", via: "token" });
});

describe("POST /api/v1/readings — access control", () => {
  it("returns 401 when authentication fails", async () => {
    authenticateApiRequest.mockResolvedValue(null);
    const res = await POST(post({ meterId: METER, value: 1 }));
    expect(res.status).toBe(401);
    expect(zaehlerFindUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/readings — validation", () => {
  it("returns 400 for a non-JSON body", async () => {
    const res = await POST(post("this is not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 with issues for a schema-invalid payload", async () => {
    const res = await POST(post({ meterId: "not-a-uuid", value: -5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
  });

  it("returns 404 when the meter does not exist", async () => {
    zaehlerFindUnique.mockResolvedValue(null);
    const res = await POST(post({ meterId: METER, value: 100 }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/readings — plausibility & persistence", () => {
  beforeEach(() => {
    zaehlerFindUnique.mockResolvedValue({ id: METER, name: "Strom", einheit: "kWh", aktiv: true });
  });

  it("rejects an implausible (negative-consumption) reading with 422", async () => {
    ablesungFindMany.mockResolvedValue([
      {
        id: "prev",
        datum: new Date("2024-01-01"),
        wert: 100,
        zaehlerGetauscht: false,
        startwertNeu: null,
      },
    ]);
    const res = await POST(post({ meterId: METER, value: 50, timestamp: "2024-02-01" }));
    expect(res.status).toBe(422);
    expect(ablesungCreate).not.toHaveBeenCalled();
  });

  it("stores an implausible reading anyway when allowImplausible is set", async () => {
    ablesungFindMany.mockResolvedValue([
      {
        id: "prev",
        datum: new Date("2024-01-01"),
        wert: 100,
        zaehlerGetauscht: false,
        startwertNeu: null,
      },
    ]);
    ablesungCreate.mockResolvedValue({
      id: "new",
      datum: new Date("2024-02-01"),
      wert: 50,
      quelle: "api",
    });
    const res = await POST(
      post({ meterId: METER, value: 50, timestamp: "2024-02-01", allowImplausible: true }),
    );
    expect(res.status).toBe(201);
    expect(ablesungCreate).toHaveBeenCalled();
  });

  it("creates a plausible reading and returns 201 with the persisted record", async () => {
    ablesungCreate.mockResolvedValue({
      id: "new-id",
      datum: new Date("2024-02-01T00:00:00Z"),
      wert: 1234.5,
      quelle: "api",
    });
    const res = await POST(post({ meterId: METER, value: 1234.5, timestamp: "2024-02-01" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.reading).toMatchObject({ id: "new-id", meterId: METER, source: "api" });
    expect(ablesungCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ zaehlerId: METER, quelle: "api" }) }),
    );
  });
});

describe("POST /api/v1/readings — rate limiting", () => {
  it("returns 429 once the per-IP window is exhausted", async () => {
    // Pre-exhaust the same bucket the route uses (no forwarded IP → "unknown").
    for (let i = 0; i < 120; i += 1) {
      rateLimit({ key: "readings:unknown", limit: 120, windowMs: 60_000 });
    }
    const res = await POST(post({ meterId: METER, value: 1 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    // The limiter short-circuits before auth/DB work.
    expect(authenticateApiRequest).not.toHaveBeenCalled();
  });
});
