import { beforeEach, describe, expect, it, vi } from "vitest";

// ZW-10. Die Rechenfunktion (`checkReadingPlausibility`) hat eigene Tests —
// die fehlende Stelle war der AUFRUF: `createAblesungAction` schrieb ungeprüft,
// während `POST /api/v1/readings` denselben Fall seit API-02 mit 422 ablehnte.
// Deshalb geht dieser Test über die Server Action und nicht über die Rechnung.
//
// Gemockt sind nur Prisma, der App-Zugriff und die Revalidierung; Zod-Schema
// und Verbrauchslogik bleiben echt, sonst prüfte der Test seine eigene Attrappe.
const { zaehlerFindUnique, ablesungFindMany, ablesungCreate, assertAppAccess } = vi.hoisted(() => ({
  zaehlerFindUnique: vi.fn(),
  ablesungFindMany: vi.fn(),
  ablesungCreate: vi.fn(),
  assertAppAccess: vi.fn(),
}));

vi.mock("@zaehlwerk/database", async () => {
  const shared =
    await vi.importActual<typeof import("@zaehlwerk/database/shared")>("@zaehlwerk/database/shared");
  return {
    ...shared,
    Prisma: { PrismaClientKnownRequestError: class extends Error {} },
    prisma: {
      zaehler: { findUnique: zaehlerFindUnique },
      ablesung: { findMany: ablesungFindMany, create: ablesungCreate },
    },
  };
});
vi.mock("./app-access", () => ({ assertAppAccess, allowedAppIdsFor: vi.fn() }));
vi.mock("./auth-helpers", () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAblesungAction } from "./zaehler-actions";
import { initialActionState } from "./action-state";

const METER = "22222222-2222-4222-8222-222222222222";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const previousReading = {
  id: "a",
  datum: new Date("2026-01-01T00:00:00.000Z"),
  wert: 1000,
  zaehlerGetauscht: false,
  startwertNeu: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  assertAppAccess.mockResolvedValue(undefined);
  zaehlerFindUnique.mockResolvedValue({ einheit: "kWh" });
  ablesungFindMany.mockResolvedValue([previousReading]);
  ablesungCreate.mockResolvedValue({ id: "neu" });
});

describe("createAblesungAction — Plausibilität", () => {
  it("speichert einen steigenden Stand ohne Rückfrage", async () => {
    const result = await createAblesungAction(
      initialActionState,
      form({ zaehlerId: METER, datum: "2026-02-01", wert: "1120" }),
    );

    expect(result.success).toBe(true);
    expect(result.confirm).toBeUndefined();
    expect(ablesungCreate).toHaveBeenCalledTimes(1);
  });

  it("fragt zurück statt zu schreiben, wenn der Stand unter dem letzten liegt", async () => {
    const result = await createAblesungAction(
      initialActionState,
      form({ zaehlerId: METER, datum: "2026-02-01", wert: "958" }),
    );

    expect(result.success).toBe(false);
    expect(result.confirm?.token).toBe("allowImplausible");
    // Die konkrete Zahl ist der Zweck der Rückfrage — "ungültig" liesse nur raten.
    expect(result.confirm?.message).toContain("-42 kWh");
    // Das ist die eigentliche Regression: Vorher wurde hier geschrieben.
    expect(ablesungCreate).not.toHaveBeenCalled();
  });

  it("schreibt nach ausdrücklicher Bestätigung", async () => {
    const result = await createAblesungAction(
      initialActionState,
      form({ zaehlerId: METER, datum: "2026-02-01", wert: "958", allowImplausible: "on" }),
    );

    expect(result.success).toBe(true);
    expect(ablesungCreate).toHaveBeenCalledTimes(1);
  });

  it("fragt bei einem Zählertausch mit Startwert nicht zurück", async () => {
    // Der legitime Fall: Der neue Zähler beginnt bei 0, der Stand fällt also.
    ablesungFindMany.mockResolvedValue([]);
    const result = await createAblesungAction(
      initialActionState,
      form({
        zaehlerId: METER,
        datum: "2026-02-01",
        wert: "9000",
        zaehlerGetauscht: "on",
        startwertNeu: "0",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.confirm).toBeUndefined();
  });

  it("fragt beim ersten Stand eines Zählers nicht zurück", async () => {
    ablesungFindMany.mockResolvedValue([]);
    const result = await createAblesungAction(
      initialActionState,
      form({ zaehlerId: METER, datum: "2026-01-01", wert: "5" }),
    );

    expect(result.success).toBe(true);
    expect(result.confirm).toBeUndefined();
  });

  it("prüft nur die Standardreihe, gelöschte Stände zählen nicht mit", async () => {
    await createAblesungAction(
      initialActionState,
      form({ zaehlerId: METER, datum: "2026-02-01", wert: "1120" }),
    );

    // Über den ganzen Zähler gerechnet liefen Bezug und Einspeisung ineinander;
    // da beide unabhängig hochzählen, sähe fast jeder Stand negativ aus.
    const where = ablesungFindMany.mock.calls[0]?.[0]?.where;
    expect(where.zaehlerId).toBe(METER);
    expect(where.OR).toBeDefined();
    expect(where).toHaveProperty("geloeschtAm");
  });
});
