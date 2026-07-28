import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateApiRequest, zaehlerFindUnique, zaehlerUpdate, zaehlerDelete } = vi.hoisted(
  () => ({
    authenticateApiRequest: vi.fn(),
    zaehlerFindUnique: vi.fn(),
    zaehlerUpdate: vi.fn(),
    zaehlerDelete: vi.fn(),
  }),
);

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
    Prisma: { PrismaClientKnownRequestError: class extends Error {} },
    prisma: {
      zaehler: { findUnique: zaehlerFindUnique, update: zaehlerUpdate, delete: zaehlerDelete },
    },
  };
});

vi.mock("../../../../lib/audit", () => ({
  AUDIT_ACTIONS: { apiMeterUpdate: "api.meter_update", apiMeterDelete: "api.meter_delete" },
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE, PATCH } from "./route";
import { __resetRateLimits } from "../../../../lib/rate-limit";

const METER = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ id: METER }) };

function request(method: string, body?: unknown, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/meters/${METER}${query}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

const stored = {
  id: METER,
  name: "Hauptzähler",
  kategorie: "STROM",
  einheit: "kWh",
  farbe: "#fff",
  icon: "bolt",
  aktiv: true,
  sortIndex: 0,
  locationId: null,
  stellen: 6,
  ableseIntervallTage: 0,
};

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset().mockResolvedValue({
    id: "u1",
    email: "admin@b.de",
    role: "ADMIN",
    via: "token",
  });
  zaehlerFindUnique.mockReset().mockResolvedValue({ ...stored, _count: { ablesungen: 0 } });
  zaehlerUpdate.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...stored,
    ...data,
  }));
  zaehlerDelete.mockReset().mockResolvedValue(stored);
});

describe("PATCH", () => {
  it("weist ohne Ausweis ab, bevor die Datenbank befragt wird", async () => {
    authenticateApiRequest.mockResolvedValue(null);
    const res = await PATCH(request("PATCH", { name: "Neu" }), params);
    expect(res.status).toBe(401);
    expect(zaehlerFindUnique).not.toHaveBeenCalled();
  });

  it("aendert nur das genannte Feld", async () => {
    await PATCH(request("PATCH", { name: "Neuer Name" }), params);
    const call = zaehlerUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toEqual({ name: "Neuer Name" });
  });

  it("kann den Standort ausdruecklich leeren", async () => {
    // `null` heisst „loesen", `undefined` heisst „nicht erwaehnt". Ohne die
    // Unterscheidung gaebe es keinen Weg, einen Zaehler wieder standortlos zu
    // machen.
    await PATCH(request("PATCH", { locationId: null }), params);
    const call = zaehlerUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.location).toEqual({ disconnect: true });
  });

  it("antwortet 404 fuer einen unbekannten Zaehler", async () => {
    zaehlerFindUnique.mockResolvedValue(null);
    const res = await PATCH(request("PATCH", { name: "Neu" }), params);
    expect(res.status).toBe(404);
    expect(zaehlerUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("ist Administratoren vorbehalten", async () => {
    // Ein durchgesickertes Automations-Token darf Staende melden — aber keine
    // Zeitreihe entfernen.
    authenticateApiRequest.mockResolvedValue({
      id: "u2",
      email: "bot@b.de",
      role: "USER",
      via: "token",
    });
    const res = await DELETE(request("DELETE"), params);
    expect(res.status).toBe(403);
    expect(zaehlerDelete).not.toHaveBeenCalled();
  });

  it("legt einen Zaehler MIT Ablesungen nur still", async () => {
    // Der wichtigste Test dieser Datei. An einem Zaehler haengen seine
    // Ablesungen per Cascade — ein versehentliches DELETE loescht keine Zeile,
    // sondern eine Zeitreihe, und die ist nicht wiederherstellbar.
    zaehlerFindUnique.mockResolvedValue({ ...stored, _count: { ablesungen: 42 } });

    const res = await DELETE(request("DELETE"), params);

    expect(res.status).toBe(200);
    expect(zaehlerDelete).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.deactivated).toBe(true);
    expect(json.hint).toContain("42");
    expect(zaehlerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { aktiv: false } }),
    );
  });

  it("loescht mit ?purge=true wirklich", async () => {
    zaehlerFindUnique.mockResolvedValue({ ...stored, _count: { ablesungen: 42 } });

    const res = await DELETE(request("DELETE", undefined, "?purge=true"), params);

    expect(res.status).toBe(200);
    expect(zaehlerDelete).toHaveBeenCalledWith({ where: { id: METER } });
    const json = await res.json();
    expect(json.readingsDeleted).toBe(42);
  });

  it("entfernt einen LEEREN Zaehler auch ohne purge", async () => {
    // Ohne Ablesungen gibt es nichts zu verlieren — meist ein Versehen beim
    // Anlegen. Ihn stillzulegen hinterliesse eine Karteileiche.
    const res = await DELETE(request("DELETE"), params);
    expect(res.status).toBe(200);
    expect(zaehlerDelete).toHaveBeenCalled();
  });

  it("antwortet 404 statt blind zu loeschen", async () => {
    zaehlerFindUnique.mockResolvedValue(null);
    const res = await DELETE(request("DELETE"), params);
    expect(res.status).toBe(404);
    expect(zaehlerDelete).not.toHaveBeenCalled();
  });
});
