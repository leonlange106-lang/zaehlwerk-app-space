import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth wird gemockt, damit die Autorisierung direkt gesteuert werden kann; die
// Abbildung von Datenbankzeilen auf die API-Antwort bleibt echt — sie ist der
// Gegenstand dieser Tests.
const { authenticateApiRequest, zaehlerFindMany } = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  zaehlerFindMany: vi.fn(),
}));
vi.mock("../../../lib/api-auth", () => ({
  authenticateApiRequest,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
}));
vi.mock("@zaehlwerk/database", () => ({
  // Der Soft-Delete-Filter kommt aus dem Datenpaket und wird von der Route
  // gesetzt — ohne ihn im Mock schlaegt schon der Import fehl.
  NOT_DELETED: { geloeschtAm: null },
  prisma: { zaehler: { findMany: zaehlerFindMany } },
}));

import { GET } from "./route";
import { __resetRateLimits } from "../../../lib/rate-limit";

function get(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/meters${query}`, {
    headers: { authorization: "Bearer zw_pat_test" },
  });
}

/** Eine Ablesung, wie Prisma sie liefert. */
function reading(wert: number, iso: string) {
  return { datum: new Date(iso), wert, quelle: "api" };
}

beforeEach(() => {
  __resetRateLimits();
  authenticateApiRequest.mockReset();
  zaehlerFindMany.mockReset();
  authenticateApiRequest.mockResolvedValue({ id: "t1", name: "Token" });
});

describe("GET /api/v1/meters — Zweirichtungszähler", () => {
  /**
   * Bezug bei 9000, Einspeisung bei 40 — und die Einspeisung ist NEUER.
   *
   * Genau hier lag die Falle: `current` war "die neueste Ablesung des Zählers".
   * Mit einem zweiten Register wäre das mal der Bezug und mal die Einspeisung,
   * je nachdem, welcher Wert zuletzt eintraf. Dasselbe Feld hätte von Tag zu Tag
   * eine andere Bedeutung — und ein Aufrufer, der daraus seinen Netzbezug
   * ableitet, bekäme unbemerkt die Einspeisung.
   */
  const zweirichtung = [
    {
      id: "z1",
      name: "Strom",
      kategorie: "STROM",
      einheit: "kWh",
      farbe: "#fff",
      ableseIntervallTage: 0,
      location: null,
      ablesungen: [reading(40, "2026-07-02T00:00:00Z")],
      register: [
        {
          id: "r1",
          obisCode: "1.8.0",
          richtung: "BEZUG",
          label: "Bezug",
          einheit: "kWh",
          ablesungen: [reading(9000, "2026-07-01T00:00:00Z")],
        },
        {
          id: "r2",
          obisCode: "2.8.0",
          richtung: "EINSPEISUNG",
          label: "Einspeisung",
          einheit: "kWh",
          ablesungen: [reading(40, "2026-07-02T00:00:00Z")],
        },
      ],
    },
  ];

  it("meldet als `current` den Bezug, nicht die neuere Einspeisung", async () => {
    zaehlerFindMany.mockResolvedValue(zweirichtung);
    const body = await (await GET(get())).json();
    expect(body.meters[0].current.value).toBe(9000);
  });

  it("weist beide Register einzeln aus und saldiert sie nicht", async () => {
    zaehlerFindMany.mockResolvedValue(zweirichtung);
    const body = await (await GET(get())).json();

    expect(body.meters[0].registers).toHaveLength(2);
    expect(body.meters[0].registers.map((r: { obisCode: string }) => r.obisCode)).toEqual([
      "1.8.0",
      "2.8.0",
    ]);
    expect(body.meters[0].registers[1]).toMatchObject({
      direction: "EINSPEISUNG",
      current: { value: 40 },
    });
    // Kein saldierter Gesamtwert: Die Verrechnung ist eine Interpretation, die
    // der Aufrufer treffen soll — fürs HA-Energie-Dashboard sind es ohnehin
    // getrennte Sensoren.
    expect(body.meters[0]).not.toHaveProperty("net");
  });

  it("liefert die Historie des Bezugs, nicht die vermischte Reihe", async () => {
    zaehlerFindMany.mockResolvedValue([
      {
        ...zweirichtung[0],
        register: [
          {
            ...zweirichtung[0].register[0],
            ablesungen: [reading(9000, "2026-07-01T00:00:00Z"), reading(8900, "2026-06-01T00:00:00Z")],
          },
          zweirichtung[0].register[1],
        ],
      },
    ]);
    const body = await (await GET(get("?history=5"))).json();
    expect(body.meters[0].history.map((h: { value: number }) => h.value)).toEqual([9000, 8900]);
  });
});

describe("GET /api/v1/meters — Zähler ohne Register", () => {
  it("faellt auf die neueste Ablesung zurueck", async () => {
    // Ein Zaehler, auf den seit der Migration nichts geschrieben wurde, kann
    // registerlos sein. Er darf deswegen nicht ohne aktuellen Wert dastehen.
    zaehlerFindMany.mockResolvedValue([
      {
        id: "z2",
        name: "Wasser",
        kategorie: "WASSER",
        einheit: "m³",
        farbe: "#fff",
        ableseIntervallTage: 0,
        location: null,
        ablesungen: [reading(123, "2026-07-01T00:00:00Z")],
        register: [],
      },
    ]);
    const body = await (await GET(get())).json();
    expect(body.meters[0].current.value).toBe(123);
    expect(body.meters[0].registers).toEqual([]);
  });
});
