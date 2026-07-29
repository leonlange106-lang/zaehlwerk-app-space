import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Prüfstelle für Forward-Auth. Gemockt sind nur die Sitzung und die
// 2FA-Auflösung — die Antwortlogik (Weiterleitung vs. Problem-JSON, Header,
// Cache-Verbot) bleibt echt, denn genau sie entscheidet, ob der Aufbau am Proxy
// funktioniert.
const { getSessionUser, resolveTwoFactorGate } = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveTwoFactorGate: vi.fn(),
}));
vi.mock("../../../lib/auth-helpers", () => ({ getSessionUser }));
vi.mock("../../../lib/two-factor-policy", () => ({ resolveTwoFactorGate }));

import { GET } from "./route";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  name: "Admin",
  role: "ADMIN" as const,
};

/** Anfrage, wie Caddy sie stellt: interne Adresse, öffentliche Header. */
function forwarded(uri: string, extra: Record<string, string> = {}) {
  return new NextRequest("http://main-portal:3000/api/auth/verify", {
    headers: {
      "x-forwarded-uri": uri,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "zaehlwerk.local",
      ...extra,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveTwoFactorGate.mockResolvedValue({ blocked: false, enforced: false });
});

describe("GET /api/auth/verify — angemeldet", () => {
  beforeEach(() => getSessionUser.mockResolvedValue(USER));

  it("antwortet 200 und gibt den Benutzer als Header zurück", async () => {
    const res = await GET(forwarded("/apps/zaehlwerk"));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Auth-User-Id")).toBe(USER.id);
    expect(res.headers.get("X-Auth-User-Email")).toBe(USER.email);
    expect(res.headers.get("X-Auth-Role")).toBe("ADMIN");
  });

  it("verbietet das Zwischenspeichern", async () => {
    // Eine zwischengespeicherte Zusage überlebt den Rechteentzug — genau die
    // Eigenschaft, wegen der die Prüfstelle existiert.
    const res = await GET(forwarded("/"));
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("setzt KEINE Auth-Header, wenn der zweite Faktor fehlt", async () => {
    resolveTwoFactorGate.mockResolvedValue({ blocked: true, enforced: true });
    const res = await GET(forwarded("/apps/zaehlwerk"));

    expect(res.status).toBe(302);
    expect(res.headers.get("X-Auth-User-Id")).toBeNull();
  });

  it("schickt bei fehlendem zweiten Faktor auf die Startseite, nicht auf /login", async () => {
    // /login sähe wie ein abgelaufener Login aus und schickte den Nutzer in eine
    // Runde, die nichts ändert — die Sitzung ist ja gültig.
    resolveTwoFactorGate.mockResolvedValue({ blocked: true, enforced: true });
    const res = await GET(forwarded("/apps/zaehlwerk"));

    expect(res.headers.get("location")).toBe("https://zaehlwerk.local/");
  });

  it("antwortet einem API-Aufruf mit 403 statt einer Weiterleitung", async () => {
    resolveTwoFactorGate.mockResolvedValue({ blocked: true, enforced: true });
    const res = await GET(forwarded("/api/notifications"));

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("GET /api/auth/verify — ZW_LOGIN_ORIGIN (zweiter Dienst)", () => {
  // Der Fall, der mit nur EINEM Dienst nicht auftreten kann: Fragt ein zweiter
  // Dienst (das Portal) an, darf die Weiterleitung nicht auf DESSEN Host
  // zeigen — dort gibt es kein /login, der Besucher landet im 404.
  beforeEach(() => {
    getSessionUser.mockResolvedValue(null);
    delete process.env.ZW_LOGIN_ORIGIN;
  });
  afterEach(() => {
    delete process.env.ZW_LOGIN_ORIGIN;
  });

  it("schickt zur konfigurierten Anmeldung statt zum anfragenden Dienst", async () => {
    process.env.ZW_LOGIN_ORIGIN = "https://zaehlwerk.local";
    const res = await GET(
      new NextRequest("http://portal:3010/api/auth/verify", {
        headers: {
          "x-forwarded-uri": "/admin",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "portal.local",
          "sec-fetch-mode": "navigate",
        },
      }),
    );

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.host).toBe("zaehlwerk.local");
    // Das Ziel bleibt erhalten: nach der Anmeldung zurueck zum Portal-Pfad.
    expect(location.searchParams.get("callbackUrl")).toBe("/admin");
  });

  it("bleibt ohne die Variable beim anfragenden Dienst", async () => {
    // Eine Instanz mit nur einem Dienst soll nichts konfigurieren muessen.
    const res = await GET(forwarded("/", { "sec-fetch-mode": "navigate" }));
    expect(new URL(res.headers.get("location") ?? "").host).toBe("zaehlwerk.local");
  });

  it("ignoriert einen unbrauchbaren Wert, statt die Anmeldung zu zerstoeren", async () => {
    process.env.ZW_LOGIN_ORIGIN = "kein-url";
    const res = await GET(forwarded("/", { "sec-fetch-mode": "navigate" }));
    expect(new URL(res.headers.get("location") ?? "").host).toBe("zaehlwerk.local");
  });

  it("nimmt nur den Ursprung, nicht einen mitgegebenen Pfad", async () => {
    process.env.ZW_LOGIN_ORIGIN = "https://zaehlwerk.local/irgendwo";
    const res = await GET(forwarded("/", { "sec-fetch-mode": "navigate" }));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("GET /api/auth/verify — nicht angemeldet", () => {
  beforeEach(() => getSessionUser.mockResolvedValue(null));

  it("leitet eine Seitennavigation auf /login um", async () => {
    const res = await GET(forwarded("/apps/zaehlwerk", { "sec-fetch-mode": "navigate" }));

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/apps/zaehlwerk");
  });

  it("baut die Weiterleitung aus den X-Forwarded-Headern, nicht aus der internen Adresse", async () => {
    // DIE Falle dieses Endpunkts: Der Proxy spricht den Container unter
    // `main-portal:3000` an. Aus `request.url` gebaut, schickte die Weiterleitung
    // den Browser an eine Adresse, die es für ihn nicht gibt.
    const res = await GET(forwarded("/", { "sec-fetch-mode": "navigate" }));

    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^https:\/\/zaehlwerk\.local\//);
    expect(location).not.toContain("main-portal:3000");
  });

  it("antwortet einem API-Pfad mit 401 Problem-JSON", async () => {
    const res = await GET(forwarded("/api/notifications"));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("antwortet 401, wenn der Aufrufer JSON verlangt", async () => {
    const res = await GET(forwarded("/irgendwas", { accept: "application/json" }));
    expect(res.status).toBe(401);
  });

  it("nimmt keine protokoll-relative callbackUrl an", async () => {
    // `//evil.example` wäre als callbackUrl eine offene Weiterleitung auf eine
    // fremde Domain.
    const res = await GET(forwarded("//evil.example/pfad", { "sec-fetch-mode": "navigate" }));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.host).toBe("zaehlwerk.local");
    expect(location.searchParams.get("callbackUrl")).toBe("/");
  });

  it("verbietet auch bei der Ablehnung das Zwischenspeichern", async () => {
    const res = await GET(forwarded("/api/notifications"));
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
