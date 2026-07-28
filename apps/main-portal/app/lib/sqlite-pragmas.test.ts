import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));
vi.mock("@zaehlwerk/database", () => ({ prisma: { $queryRawUnsafe: queryRawUnsafe } }));

import { applySqlitePragmas } from "./sqlite-pragmas";

beforeEach(() => {
  queryRawUnsafe.mockReset().mockResolvedValue([]);
});

describe("applySqlitePragmas", () => {
  it("setzt busy_timeout VOR journal_mode", async () => {
    // Der Wechsel des journal_mode ist die eine Anweisung hier, die an einer
    // benutzten Datenbank scheitern kann. Stand er vorn, lief ausgerechnet er
    // ohne Geduld.
    await applySqlitePragmas();
    const reihenfolge = queryRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(reihenfolge.findIndex((s) => s.includes("busy_timeout"))).toBeLessThan(
      reihenfolge.findIndex((s) => s.includes("journal_mode")),
    );
  });

  it("meldet einen abgelehnten WAL-Wechsel als Fehlschlag", async () => {
    // `PRAGMA journal_mode` wirft NICHT, wenn der Wechsel abgelehnt wird — es
    // antwortet mit dem Modus, der danach gilt. Ohne diese Pruefung meldete der
    // Start WAL, obwohl die Datei im delete-Modus blieb, und niemand konnte es
    // wissen. Der Unterschied ist gross: Dort sperrt schon eine offene
    // Lesetransaktion jeden Schreiber aus — auch die Migration eines Updates.
    queryRawUnsafe.mockImplementation(async (statement: string) =>
      statement.includes("journal_mode") ? [{ journal_mode: "delete" }] : [],
    );

    const { applied, failed } = await applySqlitePragmas();

    expect(failed).toEqual(["PRAGMA journal_mode = WAL"]);
    expect(applied).toHaveLength(3);
  });

  it("nimmt einen erfolgreichen Wechsel an", async () => {
    queryRawUnsafe.mockImplementation(async (statement: string) =>
      statement.includes("journal_mode") ? [{ journal_mode: "wal" }] : [],
    );

    const { failed } = await applySqlitePragmas();

    expect(failed).toEqual([]);
  });

  it("wertet eine unbekannte Antwortform nicht als Fehlschlag", async () => {
    // Der Modus laesst sich dann nicht beurteilen. Ein falscher Alarm bei jedem
    // Start waere schlimmer als die fehlende Auskunft.
    queryRawUnsafe.mockResolvedValue(undefined);

    const { failed } = await applySqlitePragmas();

    expect(failed).toEqual([]);
  });

  it("setzt WAL, busy_timeout, synchronous und foreign_keys", async () => {
    const { applied, failed } = await applySqlitePragmas();

    expect(failed).toEqual([]);
    const statements = applied.join(" | ");
    expect(statements).toContain("journal_mode = WAL");
    expect(statements).toContain("busy_timeout = 5000");
    expect(statements).toContain("synchronous = NORMAL");
    expect(statements).toContain("foreign_keys = ON");
  });

  it("nutzt query, nicht execute", async () => {
    // `PRAGMA journal_mode` ANTWORTET mit dem gesetzten Modus. Ueber
    // $executeRawUnsafe gesetzt wirft SQLite, weil dort keine Zeilen erwartet
    // werden — der WAL-Modus waere dann still nie aktiv geworden.
    await applySqlitePragmas();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(4);
  });

  it("laeuft weiter, wenn eine Einstellung abgelehnt wird", async () => {
    // Eine Datenbank ohne WAL ist langsamer, aber funktionsfaehig. Den
    // Serverstart daran scheitern zu lassen waere die schlechtere Zusicherung —
    // und eine abgelehnte Einstellung darf die folgenden nicht verhindern.
    queryRawUnsafe.mockRejectedValueOnce(new Error("nicht unterstuetzt"));

    const { applied, failed } = await applySqlitePragmas();

    expect(failed).toHaveLength(1);
    expect(applied).toHaveLength(3);
  });
});
