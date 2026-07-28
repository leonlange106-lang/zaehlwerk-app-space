import { describe, expect, it } from "vitest";
import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  fullBackupSchema,
  meterExportSchema,
} from "./backup";

const envelope = {
  app: BACKUP_APP_ID,
  schemaVersion: BACKUP_SCHEMA_VERSION,
  generatedAt: "2026-07-28T10:00:00.000Z",
};

const zaehler = {
  id: "z-1",
  name: "Hauptzähler",
  kategorie: "STROM" as const,
  einheit: "kWh",
  stellen: 6,
  ableseIntervallTage: 30,
};

const register = [
  {
    id: "r-1",
    zaehlerId: "z-1",
    obisCode: "1.8.0",
    richtung: "BEZUG" as const,
    einheit: "kWh",
    label: "Bezug",
    sortIndex: 0,
  },
  {
    id: "r-2",
    zaehlerId: "z-1",
    obisCode: "2.8.0",
    richtung: "EINSPEISUNG" as const,
    einheit: "kWh",
    label: "Einspeisung",
    sortIndex: 3,
  },
];

const ablesungen = [
  { id: "a-1", zaehlerId: "z-1", registerId: "r-1", datum: "2026-06-01", wert: 45000 },
  { id: "a-2", zaehlerId: "z-1", registerId: "r-2", datum: "2026-06-01", wert: 1200 },
];

describe("Vollbackup", () => {
  it("traegt Register, Registerbezug und Zaehlereigenschaften mit", () => {
    // Der Kern: Fehlt eines dieser Felder, faellt ein Zweirichtungszaehler beim
    // Einspielen wieder in EINE Reihe zusammen — Bezug und Einspeisung
    // verschraenkt, jedes zweite Intervall negativ. Rueckgaengig machen laesst
    // sich das nicht, weil die Zuordnung nirgends sonst mehr steht.
    const parsed = fullBackupSchema.parse({
      ...envelope,
      kind: "full-backup",
      data: { locations: [], zaehler: [zaehler], register, ablesungen, tarife: [] },
    });

    expect(parsed.data.register).toHaveLength(2);
    expect(parsed.data.register?.[1]?.richtung).toBe("EINSPEISUNG");
    expect(parsed.data.ablesungen[1]?.registerId).toBe("r-2");
    expect(parsed.data.zaehler[0]?.stellen).toBe(6);
    expect(parsed.data.zaehler[0]?.ableseIntervallTage).toBe(30);
  });

  it("nimmt eine aeltere Datei ohne diese Felder weiterhin an", () => {
    // Die Felder kamen nachtraeglich dazu. Ein Backup von vorgestern muss sich
    // weiterhin einspielen lassen — sonst waere der Schutz vor Datenverlust
    // selbst der Datenverlust.
    const parsed = fullBackupSchema.parse({
      ...envelope,
      kind: "full-backup",
      data: {
        locations: [],
        zaehler: [{ id: "z-1", name: "Alt", kategorie: "STROM", einheit: "kWh" }],
        ablesungen: [{ id: "a-1", zaehlerId: "z-1", datum: "2025-01-01", wert: 100 }],
        tarife: [],
      },
    });

    expect(parsed.data.register).toBeUndefined();
    expect(parsed.data.ablesungen[0]?.registerId).toBeUndefined();
  });

  it("weist eine unbekannte Richtung ab", () => {
    // Ein freier String liesse eine dritte Richtung entstehen, die nirgends
    // gedeutet wird.
    const result = fullBackupSchema.safeParse({
      ...envelope,
      kind: "full-backup",
      data: {
        locations: [],
        zaehler: [zaehler],
        register: [{ ...register[0], richtung: "RUECKWAERTS" }],
        ablesungen: [],
        tarife: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("Zaehler-Export", () => {
  it("traegt die Register ebenfalls mit", () => {
    const parsed = meterExportSchema.parse({
      ...envelope,
      kind: "meter-export",
      data: { zaehler, register, ablesungen, tarife: [] },
    });
    expect(parsed.data.register).toHaveLength(2);
    expect(parsed.data.ablesungen[0]?.registerId).toBe("r-1");
  });

  it("bleibt fuer aeltere Exporte gueltig", () => {
    const parsed = meterExportSchema.parse({
      ...envelope,
      kind: "meter-export",
      data: {
        zaehler: { id: "z-1", name: "Alt", kategorie: "WASSER", einheit: "m³" },
        ablesungen: [],
        tarife: [],
      },
    });
    expect(parsed.data.register).toBeUndefined();
  });
});
