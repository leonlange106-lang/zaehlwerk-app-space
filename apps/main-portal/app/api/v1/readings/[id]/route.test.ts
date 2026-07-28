import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth ist gemockt, damit sich die Berechtigung direkt steuern laesst. Zod und
// die Verbrauchslogik bleiben ECHT — sonst pruefte der Test die Attrappe.
const {
  authenticateApiRequest,
  ablesungFindUnique,
  ablesungFindMany,
  ablesungUpdate,
  ablesungDelete,
  zaehlerFindUnique,
} = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  ablesungFindUnique: vi.fn(),
  ablesungFindMany: vi.fn(),
  ablesungUpdate: vi.fn(),
  ablesungDelete: vi.fn(),
  zaehlerFindUnique: vi.fn(),
}));

vi.mock("../../../../lib/api-auth", () => ({
  authenticateApiRequest,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

vi.mock("@zaehlwerk/database", async () => {
  const shared =
    await vi.importActual<typeof import("@zaehlwerk/database/shared")>("@zaehlwerk/database/shared");
  return {
    ...shared,
    prisma: {
      ablesung: {
        findUnique: ablesungFindUnique,
        findMany: ablesungFindMany,
        update: ablesungUpdate,
        delete: ablesungDelete,
      },
      zaehler: { findUnique: zaehlerFindUnique },
    },
  };
});

vi.mock("../../../../lib/audit", () => ({
  AUDIT_ACTIONS: { apiReadingUpdate: "api.reading_update", apiReadingDelete: "api.reading_delete" },
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE, GET, PATCH } from "./route";
import { __resetRateLimits } from "../../../../lib/rate-limit";

const READING = "33333333-3333-4333-8333-333333333333";
const METER = "22222222-2222-4222-8222-222222222222";

const params = { params: Promise.resolve({ id: READING }) };

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/readings/${READING}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

const stored = {
  id: READING,
  zaehlerId: METER,
  registerId: "reg-1",
  datum: new Date("2026-06-01T00:00:00Z"),
  wert: 1000,
  kosten: null,
  notiz: "alt",
  quelle: "api",
  zaehlerGetauscht: false,
  startwertNeu: null,
};

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset().mockResolvedValue({
    id: "u1",
    email: "dev@b.de",
    role: "USER",
    via: "token",
  });
  ablesungFindUnique.mockReset().mockResolvedValue(stored);
  ablesungFindMany.mockReset().mockResolvedValue([]);
  ablesungUpdate.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...stored,
    ...data,
  }));
  ablesungDelete.mockReset().mockResolvedValue(stored);
  zaehlerFindUnique.mockReset().mockResolvedValue({ stellen: null });
});

describe("Zugriffsschutz", () => {
  // Die Lehre aus BUG-02: Der Guard wird MITgeprueft, nicht nur der Handler.
  // Ein Endpunkt, der am Rand abgewiesen wird, ist unerreichbar, egal wie
  // richtig sein Handler rechnet.
  it("weist jede Methode ohne Ausweis ab, bevor die Datenbank befragt wird", async () => {
    authenticateApiRequest.mockResolvedValue(null);

    for (const [method, call] of [
      ["GET", () => GET(request("GET"), params)],
      ["PATCH", () => PATCH(request("PATCH", { value: 1 }), params)],
      ["DELETE", () => DELETE(request("DELETE"), params)],
    ] as const) {
      const res = await call();
      expect(res.status, method).toBe(401);
    }
    expect(ablesungFindUnique).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("liefert die Ablesung im API-Vokabular", async () => {
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reading).toMatchObject({ id: READING, meterId: METER, value: 1000 });
  });

  it("antwortet 404 im Problem-Format", async () => {
    ablesungFindUnique.mockResolvedValue(null);
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.type).toContain("not-found");
    expect(json.detail).toContain(READING);
  });
});

describe("PATCH", () => {
  it("aendert NUR das genannte Feld", async () => {
    // Der Kern von PATCH. Wer den Wert korrigiert, darf dabei nicht die Notiz
    // verlieren, die er nie erwaehnt hat.
    await PATCH(request("PATCH", { value: 1500 }), params);
    const call = ablesungUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.wert).toBe(1500);
    expect(call.data).not.toHaveProperty("notiz");
    expect(call.data).not.toHaveProperty("kosten");
  });

  it("unterscheidet Notiz-leeren von Notiz-nicht-anfassen", async () => {
    // Ohne diese Unterscheidung gaebe es keinen Weg, ein Feld ueber die API
    // wieder zu leeren — deshalb `nullish` im Schema und nicht `optional`.
    await PATCH(request("PATCH", { note: null }), params);
    const call = ablesungUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.notiz).toBeNull();
  });

  it("weist einen unplausiblen Stand mit 422 ab", async () => {
    ablesungFindMany.mockResolvedValue([
      {
        id: "prev",
        datum: new Date("2026-05-01T00:00:00Z"),
        wert: 900,
        zaehlerGetauscht: false,
        startwertNeu: null,
      },
    ]);
    const res = await PATCH(request("PATCH", { value: 500 }), params);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.type).toContain("unprocessable");
    expect(json.plausibility.value).toBe(500);
    expect(ablesungUpdate).not.toHaveBeenCalled();
  });

  it("speichert ihn trotzdem, wenn allowImplausible gesetzt ist", async () => {
    ablesungFindMany.mockResolvedValue([
      {
        id: "prev",
        datum: new Date("2026-05-01T00:00:00Z"),
        wert: 900,
        zaehlerGetauscht: false,
        startwertNeu: null,
      },
    ]);
    const res = await PATCH(request("PATCH", { value: 500, allowImplausible: true }), params);
    expect(res.status).toBe(200);
    expect(ablesungUpdate).toHaveBeenCalled();
  });

  it("prueft die Reihe OHNE die Ablesung selbst", async () => {
    // Sonst pruefte man den neuen Stand gegen den alten desselben Datensatzes,
    // und jede Korrektur nach unten waere „unplausibel".
    await PATCH(request("PATCH", { value: 1500 }), params);
    const call = ablesungFindMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where.id).toEqual({ not: READING });
  });

  it("laesst keinen Startwert ohne Zaehlertausch zurueck", async () => {
    // Der zusammengefuehrte Fall: Wer nur `zaehlerGetauscht: false` sendet,
    // liesse sonst einen Startwert stehen, der zu nichts mehr gehoert.
    ablesungFindUnique.mockResolvedValue({ ...stored, zaehlerGetauscht: true, startwertNeu: 10 });
    const res = await PATCH(request("PATCH", { zaehlerGetauscht: false }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors[0].field).toBe("startwertNeu");
    expect(ablesungUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("loescht und gibt den entfernten Datensatz zurueck", async () => {
    const res = await DELETE(request("DELETE"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // Der Wert muss in der Antwort stehen: Nach dem Loeschen ist die Zeile fort.
    expect(json.deleted.value).toBe(1000);
    expect(ablesungDelete).toHaveBeenCalledWith({ where: { id: READING } });
  });

  it("antwortet 404 statt blind zu loeschen", async () => {
    ablesungFindUnique.mockResolvedValue(null);
    const res = await DELETE(request("DELETE"), params);
    expect(res.status).toBe(404);
    expect(ablesungDelete).not.toHaveBeenCalled();
  });
});
