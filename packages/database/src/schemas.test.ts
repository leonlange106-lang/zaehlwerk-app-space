import { describe, expect, it } from "vitest";
import {
  ablesungCreateSchema,
  apiReadingCreateSchema,
  tarifCreateSchema,
  zaehlerCreateSchema,
} from "./schemas";
import { setupAdminSchema, userCreateSchema } from "./auth";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("apiReadingCreateSchema (Smart-Home ingestion payload)", () => {
  it("accepts a minimal valid payload and defaults the flags", () => {
    const parsed = apiReadingCreateSchema.safeParse({ meterId: UUID, value: 1234.56 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.zaehlerGetauscht).toBe(false);
      expect(parsed.data.allowImplausible).toBe(false);
    }
  });

  it("rejects a non-UUID meterId", () => {
    const parsed = apiReadingCreateSchema.safeParse({ meterId: "not-a-uuid", value: 1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative, non-finite and over-cap values", () => {
    expect(apiReadingCreateSchema.safeParse({ meterId: UUID, value: -1 }).success).toBe(false);
    expect(apiReadingCreateSchema.safeParse({ meterId: UUID, value: Infinity }).success).toBe(false);
    expect(apiReadingCreateSchema.safeParse({ meterId: UUID, value: 2_000_000_000 }).success).toBe(
      false,
    );
  });

  it("coerces a numeric string value (devices often send strings)", () => {
    const parsed = apiReadingCreateSchema.safeParse({ meterId: UUID, value: "42.5" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.value).toBe(42.5);
  });

  it("rejects a startwertNeu supplied without a meter swap", () => {
    const parsed = apiReadingCreateSchema.safeParse({
      meterId: UUID,
      value: 100,
      startwertNeu: 10,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a swap startwert above the reading value", () => {
    const parsed = apiReadingCreateSchema.safeParse({
      meterId: UUID,
      value: 100,
      zaehlerGetauscht: true,
      startwertNeu: 150,
    });
    expect(parsed.success).toBe(false);
  });

  it("truncates an over-long note only when it violates max length", () => {
    const parsed = apiReadingCreateSchema.safeParse({
      meterId: UUID,
      value: 1,
      note: "x".repeat(501),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ablesungCreateSchema", () => {
  it("enforces the meter-swap consistency rules", () => {
    expect(
      ablesungCreateSchema.safeParse({ zaehlerId: UUID, datum: "2024-01-01", wert: 100 }).success,
    ).toBe(true);
    expect(
      ablesungCreateSchema.safeParse({
        zaehlerId: UUID,
        datum: "2024-01-01",
        wert: 100,
        zaehlerGetauscht: true,
        startwertNeu: 200,
      }).success,
    ).toBe(false);
  });
});

describe("zaehlerCreateSchema", () => {
  it("requires a name and a known energy category", () => {
    expect(
      zaehlerCreateSchema.safeParse({ name: "Strom Haus", kategorie: "STROM", einheit: "kWh" })
        .success,
    ).toBe(true);
    expect(
      zaehlerCreateSchema.safeParse({ name: "", kategorie: "STROM", einheit: "kWh" }).success,
    ).toBe(false);
    expect(
      zaehlerCreateSchema.safeParse({ name: "X", kategorie: "PLUTONIUM", einheit: "kWh" }).success,
    ).toBe(false);
  });

  it("trims whitespace-only names to an invalid empty string", () => {
    expect(
      zaehlerCreateSchema.safeParse({ name: "   ", kategorie: "STROM", einheit: "kWh" }).success,
    ).toBe(false);
  });
});

describe("tarifCreateSchema", () => {
  it("rejects gueltigBis earlier than gueltigAb", () => {
    const parsed = tarifCreateSchema.safeParse({
      zaehlerId: UUID,
      gueltigAb: "2024-06-01",
      gueltigBis: "2024-01-01",
      arbeitspreisCtNetto: 30,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("auth schemas", () => {
  it("enforces an 8-char minimum password on setup and user creation", () => {
    expect(
      setupAdminSchema.safeParse({ email: "a@b.de", password: "short" }).success,
    ).toBe(false);
    expect(
      userCreateSchema.safeParse({ email: "a@b.de", password: "longenough", role: "USER" }).success,
    ).toBe(true);
  });

  it("rejects an unknown role and a malformed email", () => {
    expect(
      userCreateSchema.safeParse({ email: "a@b.de", password: "longenough", role: "ROOT" }).success,
    ).toBe(false);
    expect(
      userCreateSchema.safeParse({ email: "not-an-email", password: "longenough", role: "USER" })
        .success,
    ).toBe(false);
  });
});
