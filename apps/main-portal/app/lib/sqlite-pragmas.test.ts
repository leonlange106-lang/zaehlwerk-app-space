import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));
vi.mock("@zaehlwerk/database", () => ({ prisma: { $queryRawUnsafe: queryRawUnsafe } }));

import { applySqlitePragmas } from "./sqlite-pragmas";

beforeEach(() => {
  queryRawUnsafe.mockReset().mockResolvedValue([]);
});

describe("applySqlitePragmas", () => {
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
