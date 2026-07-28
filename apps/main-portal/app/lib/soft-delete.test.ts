import { describe, expect, it } from "vitest";
import { NOT_DELETED, ONLY_DELETED } from "@zaehlwerk/database/shared";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Der klassische Fehler eines Soft-Delete ist die VERGESSENE Abfrage.
 *
 * Eine gelöschte Zeile taucht dann irgendwo wieder auf — in einem Export, einer
 * Summe, einer Erinnerung —, und zwar ausgerechnet dort, wo niemand hinsieht.
 * Die Filterkonstanten selbst zu prüfen wäre wertlos; interessant ist, ob sie
 * an jeder lesenden Stelle auch benutzt werden.
 *
 * Diese Datei liest deshalb den Quelltext. Das ist grob, aber es ist die
 * einzige Prüfung, die eine NEUE, ungefilterte Abfrage bemerkt — ein Test, der
 * nur die heute bekannten Stellen durchgeht, bemerkt genau die nicht.
 */

const ROOT = path.join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Lesende Stellen, an denen gelöschte Ablesungen NICHT auftauchen dürfen. */
const MUST_FILTER: Array<{ file: string; why: string }> = [
  {
    file: "app/lib/zaehler-actions.ts",
    why: "Zählerliste, Detailseite, Übersichten und Hochrechnung",
  },
  { file: "app/lib/report-data.ts", why: "Jahresbericht als PDF" },
  { file: "app/api/export/route.ts", why: "CSV-Export" },
  { file: "app/api/v1/meters/route.ts", why: "öffentliche Leseseite" },
  { file: "app/api/v1/readings/route.ts", why: "Plausibilitätsprüfung beim Melden" },
  {
    file: "app/lib/notification-source.ts",
    why: "Ableseerinnerung — ein gelöschter Stand darf sie nicht stillhalten",
  },
];

/**
 * Stellen, die den Bestand abbilden sollen und deshalb NICHT filtern.
 *
 * Bewusst aufgezählt statt stillschweigend übergangen: Wer hier später etwas
 * hinzufügt, soll sich die Frage gestellt haben.
 */
const MUST_NOT_FILTER: Array<{ file: string; why: string }> = [
  { file: "app/lib/backup-engine.ts", why: "eine Sicherung, die Zeilen weglässt, ist keine" },
  { file: "app/api/export/meter/route.ts", why: "Zähler-Export bildet den Bestand ab" },
];

describe("Soft-Delete: jede lesende Stelle filtert", () => {
  for (const { file, why } of MUST_FILTER) {
    it(`${file} — ${why}`, () => {
      const source = read(file);
      // Jede Datei liest Ablesungen; jede muss den Filter dabei nennen.
      expect(source).toContain("NOT_DELETED");
    });
  }

  it("benutzt EINE Konstante statt fünfzehn Literale", () => {
    // `{ geloeschtAm: null }` als FILTER von Hand hinzuschreiben ist der Anfang
    // vom Auseinanderlaufen: Beim nächsten Feld heißt es an einer Stelle anders.
    //
    // Gemeint ist nur die Filterstelle. `restoreAblesungAction` SCHREIBT
    // `geloeschtAm: null` — das ist genau das Zurückholen und muss so
    // dastehen; ohne diese Unterscheidung schlüge der Test auf der einzigen
    // richtigen Verwendung an. (Beim ersten Lauf hat er das prompt getan.)
    for (const { file } of MUST_FILTER) {
      const filterLiterals = read(file)
        .split("\n")
        .filter((line) => /where[^\n]*geloeschtAm:\s*null/.test(line));
      expect(filterLiterals, file).toEqual([]);
    }
  });

  for (const { file, why } of MUST_NOT_FILTER) {
    it(`${file} filtert bewusst NICHT — ${why}`, () => {
      expect(read(file)).not.toContain("NOT_DELETED");
    });
  }
});

describe("Die Filter selbst", () => {
  it("sind zueinander komplementär", () => {
    expect(NOT_DELETED).toEqual({ geloeschtAm: null });
    expect(ONLY_DELETED).toEqual({ geloeschtAm: { not: null } });
  });
});
