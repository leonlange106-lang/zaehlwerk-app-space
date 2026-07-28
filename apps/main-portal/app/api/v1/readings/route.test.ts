import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth is mocked so we can drive the authorization outcome directly; the Zod
// schema and consumption math stay REAL (imported from the shared entry) so the
// route's validation and plausibility logic are exercised for real.
const {
  authenticateApiRequest,
  zaehlerFindUnique,
  ablesungFindMany,
  ablesungCreate,
  registerUpsert,
} = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  zaehlerFindUnique: vi.fn(),
  ablesungFindMany: vi.fn(),
  ablesungCreate: vi.fn(),
  registerUpsert: vi.fn(),
}));
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
      meterRegister: { upsert: registerUpsert },
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
  registerUpsert.mockReset();
  // Standard: der Bezug. Jeder Test, der ein anderes Register braucht, setzt
  // ihn selbst — so bleibt sichtbar, welcher Fall gerade geprueft wird.
  registerUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
    id: `reg-${create.obisCode}`,
    obisCode: create.obisCode,
    richtung: create.richtung,
    label: create.label,
  }));
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

// Der Zweirichtungszaehler fuehrt Bezug und Einspeisung gleichzeitig. Beide
// Reihen zaehlen unabhaengig hoch — sie zu vermischen macht aus jedem zweiten
// Stand einen scheinbar negativen Verbrauch.
describe("POST /api/v1/readings — Register", () => {
  beforeEach(() => {
    authenticateApiRequest.mockResolvedValue({ id: "t1", name: "Token" });
    zaehlerFindUnique.mockResolvedValue({
      id: METER,
      name: "Strom",
      einheit: "kWh",
      aktiv: true,
    });
    ablesungFindMany.mockResolvedValue([]);
    ablesungCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "a1",
      datum: data.datum,
      wert: data.wert,
      quelle: data.quelle,
    }));
  });

  it("legt ohne Angabe auf dem Bezug ab — bestehende Automationen brechen nicht", async () => {
    const res = await POST(post({ meterId: METER, value: 1000 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reading.register.obisCode).toBe("1.8.0");
    expect(body.reading.register.direction).toBe("BEZUG");
  });

  it("nimmt die Einspeisung auf und legt ihr Register bei Bedarf an", async () => {
    const res = await POST(post({ meterId: METER, obisCode: "2.8.0", value: 42 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reading.register.direction).toBe("EINSPEISUNG");
    expect(registerUpsert.mock.calls[0][0].create).toMatchObject({
      obisCode: "2.8.0",
      richtung: "EINSPEISUNG",
      einheit: "kWh",
    });
  });

  it("weist eine unbekannte Kennziffer ab, statt eine zweite Reihe zu eroeffnen", async () => {
    const res = await POST(post({ meterId: METER, obisCode: "1.9.0", value: 5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).knownObisCodes).toContain("2.8.0");
    expect(registerUpsert).not.toHaveBeenCalled();
  });

  it("prueft die Plausibilitaet NUR gegen das eigene Register", async () => {
    // Der eigentliche Fehler, den diese Trennung verhindert: Der Bezug steht bei
    // 9000, die Einspeisung faengt bei 40 an. Ueber den ganzen Zaehler gerechnet
    // waere das ein negativer Verbrauch und der Stand wuerde abgelehnt.
    await POST(post({ meterId: METER, obisCode: "2.8.0", value: 40 }));
    expect(ablesungFindMany.mock.calls[0][0].where).toEqual({ registerId: "reg-2.8.0" });
  });

  it("zaehlt registerlose Altstaende zum Bezug — der Fall nach einem Rollback", async () => {
    await POST(post({ meterId: METER, value: 1000 }));
    expect(ablesungFindMany.mock.calls[0][0].where).toMatchObject({
      zaehlerId: METER,
      OR: [{ registerId: "reg-1.8.0" }, { registerId: null }],
    });
  });
});
