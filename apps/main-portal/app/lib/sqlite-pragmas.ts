import { prisma } from "@zaehlwerk/database";

// SQLite-Betriebsparameter, einmal je Serverprozess gesetzt.
//
// Prisma oeffnet die Datenbank mit SQLite-Standardwerten, und die sind fuer eine
// Anwendung mit Hintergrunddiensten schlecht gewaehlt. `AUDIT.md` § 4.7 fuehrt
// den fehlenden WAL-Modus seit langem als offenen Punkt.
//
// Das ist bewusst KEINE Migration: Es sind Verbindungs- bzw. Dateieigenschaften,
// keine Schemaaenderung. `journal_mode` ist dauerhaft in der Datei vermerkt, die
// uebrigen gelten je Verbindung — deshalb muessen sie bei jedem Start neu
// gesetzt werden und nicht einmalig.

export interface PragmaResult {
  applied: string[];
  failed: string[];
}

/**
 * Die Einstellungen und warum jede einzelne.
 *
 * `journal_mode=WAL` — der eigentliche Punkt. Im Standardmodus (`delete`)
 * sperrt ein Schreibvorgang die gesamte Datei; jeder Lesezugriff wartet.
 * Zaehlwerk schreibt im Hintergrund (Backup-Zeitplan, Wartung, Log-Import),
 * waehrend jemand die Oberflaeche benutzt — genau die Konstellation, in der
 * das spuerbar wird. WAL laesst Lesen und Schreiben nebeneinander laufen.
 *
 * `busy_timeout=5000` — ohne das gibt SQLite bei einer belegten Sperre SOFORT
 * auf ("database is locked"), statt kurz zu warten. Fuenf Sekunden sind
 * reichlich fuer die Schreibvorgaenge hier und verwandeln einen harten Fehler
 * in eine kaum wahrnehmbare Verzoegerung.
 *
 * `synchronous=NORMAL` — im WAL-Modus die empfohlene Einstellung: Es wird nicht
 * mehr bei jedem Commit auf die Platte gezwungen, sondern beim Checkpoint. Ein
 * Absturz des Prozesses ist weiterhin unbedenklich; nur ein Stromausfall genau
 * im falschen Moment koennte die letzten Transaktionen kosten. Fuer
 * Zaehlerstaende ist das der richtige Tausch — `FULL` kostet bei jedem Schreiben.
 *
 * `foreign_keys=ON` — SQLite prueft Fremdschluessel standardmaessig NICHT. Die
 * `onDelete`-Regeln im Schema (Cascade beim Zaehler, SetNull beim Register)
 * waeren damit Dekoration. Prisma setzt das je Verbindung selbst, aber nicht
 * fuer rohe Abfragen — und die Wartung nutzt genau solche.
 */
const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
] as const;

/**
 * Einmal je Prozess anwenden. Fehler sind nicht toedlich: Eine Datenbank ohne
 * WAL laeuft langsamer, aber sie laeuft — den Serverstart daran scheitern zu
 * lassen waere die schlechtere Zusicherung.
 */
export async function applySqlitePragmas(): Promise<PragmaResult> {
  const result: PragmaResult = { applied: [], failed: [] };
  for (const statement of PRAGMAS) {
    try {
      // `$queryRawUnsafe`, nicht `$executeRawUnsafe`: `PRAGMA journal_mode`
      // ANTWORTET mit dem gesetzten Modus, und execute erwartet keine Zeilen.
      await prisma.$queryRawUnsafe(statement);
      result.applied.push(statement);
    } catch {
      result.failed.push(statement);
    }
  }
  return result;
}
