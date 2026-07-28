// WAL-Modus sicherstellen, BEVOR die Migration schreibt.
//
// Warum das hier steht und nicht der Anwendung ueberlassen bleibt:
//
// Im Standardmodus (`delete`) sperrt in SQLite schon jeder LESER die Datei
// gegen Schreiber. Die Migration laeuft absichtlich, waehrend die alte
// Anwendung noch bedient — und wer gerade die Update-Seite offen hat, laesst
// sie im Sekundentakt lesen. Der Schema-Engine von Prisma kennt kein
// `busy_timeout` und gibt beim ersten Zusammentreffen sofort auf; er findet
// dann ueber Minuten keine Luecke. Genau daran ist ein Update gescheitert.
//
// Im WAL-Modus stoeren Leser nicht mehr. Uebrig bleiben echte
// Schreiber-Kollisionen, und die dauern hier Millisekunden — dafuer genuegt die
// Wiederholung in deploy-migrations.sh.
//
// Der Wechsel geht ueber den Prisma-CLIENT, nicht ueber die CLI: Der Client
// kennt `busy_timeout` und wartet deshalb geduldig auf die kurze exklusive
// Sperre, die der Wechsel selbst braucht. Genau die Faehigkeit, die dem
// Schema-Engine fehlt.
//
// Scheitern ist NICHT toedlich. Eine Datenbank ohne WAL migriert langsamer und
// mit mehr Wiederholungen, aber sie migriert. Den Deploy hier abzubrechen waere
// die schlechtere Zusicherung — deshalb endet dieses Skript immer mit 0 und
// sagt nur, was es vorgefunden hat.
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, "..", "generated", "client", "index.js");

const BUSY_TIMEOUT_MS = Number(process.env.WAL_BUSY_TIMEOUT_MS ?? 60_000);

/** Der Modus steht in der einzigen Spalte der Antwort. */
function modeOf(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const value = rows[0]?.journal_mode;
  return typeof value === "string" ? value.toLowerCase() : null;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[wal] DATABASE_URL fehlt — uebersprungen");
  process.exit(0);
}

let client;
try {
  const { PrismaClient } = await import(CLIENT);
  client = new PrismaClient({ datasourceUrl: url });

  // ZUERST der Timeout, dann der Wechsel. Andersherum liefe die eine Anweisung,
  // die eine Sperre braucht, ohne Geduld — der Fehler, der uns hierher gebracht
  // hat.
  await client.$queryRawUnsafe(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  const vorher = modeOf(await client.$queryRawUnsafe("PRAGMA journal_mode"));
  if (vorher === "wal") {
    console.log("[wal] Journal-Modus: wal");
  } else {
    // `PRAGMA journal_mode = WAL` wirft nicht, wenn es abgelehnt wird — es
    // antwortet mit dem Modus, der danach gilt. Nur diese Antwort zaehlt.
    const nachher = modeOf(await client.$queryRawUnsafe("PRAGMA journal_mode = WAL"));
    if (nachher === "wal") {
      console.log(`[wal] Journal-Modus von ${vorher ?? "unbekannt"} auf wal umgestellt`);
    } else {
      console.log(
        `[wal] Journal-Modus bleibt ${nachher ?? vorher ?? "unbekannt"} — ` +
          "Migration kann laenger auf die Sperre warten",
      );
    }
  }
} catch (error) {
  console.log(`[wal] Journal-Modus nicht pruefbar (${error?.message ?? error}) — weiter`);
} finally {
  await client?.$disconnect().catch(() => {});
}

process.exit(0);
