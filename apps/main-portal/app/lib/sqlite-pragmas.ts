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
// Die Reihenfolge ist Teil der Sache, nicht Geschmack.
//
// `busy_timeout` steht ZUERST. Der Wechsel des `journal_mode` braucht selbst
// kurz die exklusive Sperre — er ist die eine Anweisung hier, die an einer
// benutzten Datenbank scheitern kann. Stand er vorn, lief ausgerechnet er mit
// Timeout 0 und gab beim ersten Zusammentreffen sofort auf.
const PRAGMAS = [
  "PRAGMA busy_timeout = 5000",
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
] as const;

/**
 * `PRAGMA journal_mode` ist die Ausnahme unter den Einstellungen hier: Es wirft
 * NICHT, wenn der Wechsel abgelehnt wird — es antwortet mit dem Modus, der
 * danach gilt. Ein `delete` in dieser Antwort heisst „nicht gewechselt".
 *
 * Ohne diese Pruefung meldete der Start WAL, obwohl nichts geschehen war, und
 * niemand konnte es wissen. Der Unterschied ist nicht kosmetisch: Im
 * `delete`-Modus sperrt schon jeder LESER die Datei gegen Schreiber. Eine
 * Migration, die neben der laufenden Anwendung arbeitet, findet dann keine
 * Luecke mehr — genau daran ist ein Update gescheitert.
 */
function journalModeSwitched(statement: string, rows: unknown): boolean {
  if (!statement.includes("journal_mode")) return true;
  const mode = Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)?.journal_mode
    : undefined;
  // Unbekannte Antwortform nicht als Fehlschlag werten: Der Modus laesst sich
  // dann nicht beurteilen, und ein falscher Alarm bei jedem Start waere
  // schlimmer als die fehlende Auskunft.
  if (typeof mode !== "string") return true;
  return mode.toLowerCase() === "wal";
}

/**
 * Einmal je Prozess anwenden. Fehler sind nicht toedlich: Eine Datenbank ohne
 * WAL laeuft langsamer, aber sie laeuft — den Serverstart daran scheitern zu
 * lassen waere die schlechtere Zusicherung. Auffallen muessen sie trotzdem.
 */
export async function applySqlitePragmas(): Promise<PragmaResult> {
  const result: PragmaResult = { applied: [], failed: [] };
  for (const statement of PRAGMAS) {
    try {
      // `$queryRawUnsafe`, nicht `$executeRawUnsafe`: `PRAGMA journal_mode`
      // ANTWORTET mit dem gesetzten Modus, und execute erwartet keine Zeilen.
      const rows = await prisma.$queryRawUnsafe(statement);
      if (journalModeSwitched(statement, rows)) {
        result.applied.push(statement);
      } else {
        result.failed.push(statement);
      }
    } catch {
      result.failed.push(statement);
    }
  }
  return result;
}
