#!/usr/bin/env node
/**
 * Migrationen gegen ECHTE Datenbestände prüfen (QLT-03).
 *
 * `prisma migrate deploy` auf einer leeren Datenbank beweist wenig: Es beweist,
 * dass das SQL syntaktisch geht. Die Fehler, die weh tun, entstehen woanders —
 * an bestehenden Zeilen. Zwei Beispiele aus diesem Projekt:
 *
 *   * Die Register-Migration musste jedem vorhandenen Zähler eines anlegen,
 *     ohne eine einzige Ablesung zu verändern.
 *   * Die Faktor-Migration verglich ein DateTime mit einem Datumstext. SQLite
 *     vergleicht über Typgrenzen hinweg nach TYPRANGFOLGE statt nach Wert, also
 *     lieferte `MIN(<integer>, '2021-01-01')` immer die Zahl — der Vergleich
 *     fand gar nicht statt. Auf einer leeren Datenbank faellt so etwas nie auf;
 *     es faellt auf, wenn jemand Ablesungen von 2019 hat.
 *
 * Beide Fehler wurden von Hand gefunden. Genau das automatisiert diese Datei.
 *
 * Bewusst ohne Test-Framework und ohne Prisma Client: Der Sinn ist, die
 * Migrationen so anzuwenden, wie der Deploy es tut — mit der CLI, gegen eine
 * Datei — und danach mit rohem SQL nachzusehen. Ein ORM dazwischen prüfte die
 * Sicht des ORM, nicht den Zustand der Datenbank.
 */

import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(HERE, "..");
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "prisma", "migrations");

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** Alle Migrationsordner in der Reihenfolge, in der Prisma sie anwendet. */
function migrationNames() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function deploy(dbPath, { upTo } = {}) {
  // `upTo` gibt es in Prisma nicht. Um einen Zwischenstand herzustellen, wird
  // stattdessen jede Migration bis dorthin einzeln als SQL eingespielt und
  // danach als angewendet gestempelt — genau das, was `migrate deploy` tut,
  // nur haltbar in der Mitte.
  const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };
  if (!upTo) {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: PACKAGE_ROOT,
      env,
      stdio: "pipe",
    });
    return;
  }

  const names = migrationNames();
  const stopAt = names.indexOf(upTo);
  if (stopAt === -1) throw new Error(`Unbekannte Migration: ${upTo}`);

  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  )`);

  for (const name of names.slice(0, stopAt)) {
    const sql = readMigrationSql(name);
    db.exec(sql);
    db.prepare(
      `INSERT INTO "_prisma_migrations"
       ("id","checksum","finished_at","migration_name","started_at","applied_steps_count")
       VALUES (?, 'test', current_timestamp, ?, current_timestamp, 1)`,
    ).run(`test-${name}`, name);
  }
  db.close();
}

function readMigrationSql(name) {
  return execFileSync("cat", [path.join(MIGRATIONS_DIR, name, "migration.sql")], {
    encoding: "utf8",
  });
}

function withTempDb(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "zw-migrate-"));
  const dbPath = path.join(dir, "test.db");
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ms = (iso) => new Date(iso).getTime();

// ── Fall 1: leere Datenbank ────────────────────────────────────────────────
// Der einfachste Fall, und der einzige, den ein Deploy auf einer neuen Instanz
// je sieht. Er beweist nicht viel, aber sein Fehlschlag ist eindeutig.
function testFreshDatabase() {
  console.log("\nLeere Datenbank");
  withTempDb((dbPath) => {
    deploy(dbPath);
    const db = new DatabaseSync(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);

    for (const expected of ["zaehler", "ablesungen", "meter_register", "umrechnungsfaktor"]) {
      check(`Tabelle ${expected} vorhanden`, tables.includes(expected));
    }

    const applied = db
      .prepare("SELECT COUNT(*) AS c FROM _prisma_migrations WHERE finished_at IS NOT NULL")
      .get().c;
    check("alle Migrationen als angewendet vermerkt", applied === migrationNames().length,
      `${applied} von ${migrationNames().length}`);
    db.close();
  });
}

// ── Fall 2: Bestand mit Daten ──────────────────────────────────────────────
// Der Fall, der zählt. Die Datenbank wird auf den Stand VOR den datenverändernden
// Migrationen gebracht, mit Zeilen gefüllt und dann hochgezogen.
function testExistingData() {
  console.log("\nBestehende Installation mit Daten");
  withTempDb((dbPath) => {
    // Stand direkt nach der Baseline — so sah jede Installation vor v3 aus.
    deploy(dbPath, { upTo: migrationNames()[1] });

    const db = new DatabaseSync(dbPath);
    const now = Date.now();
    const insertZaehler = db.prepare(
      `INSERT INTO zaehler
       (id,name,kategorie,einheit,farbe,icon,aktiv,sortIndex,ableseIntervallTage,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insertZaehler.run("gas-alt", "Gas alt", "GAS", "m3", "#fff", "flame", 1, 0, 0, now, now);
    insertZaehler.run("gas-neu", "Gas neu", "GAS", "m3", "#fff", "flame", 1, 0, 0, now, now);
    insertZaehler.run("strom", "Strom", "STROM", "kWh", "#fff", "bolt", 1, 0, 0, now, now);

    const insertAblesung = db.prepare(
      `INSERT INTO ablesungen
       (id,zaehlerId,datum,wert,zaehlerGetauscht,quelle,istAbgerechnet,createdAt)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    // Eine Ablesung VOR 2021 — der Fall, an dem die Faktor-Migration hing.
    insertAblesung.run("a1", "gas-alt", ms("2019-05-01"), 100, 0, "manuell", 0, now);
    insertAblesung.run("a2", "gas-alt", ms("2020-05-01"), 250, 0, "manuell", 0, now);
    insertAblesung.run("a3", "gas-neu", ms("2024-05-01"), 200, 0, "manuell", 0, now);
    insertAblesung.run("a4", "strom", ms("2024-05-01"), 5000, 0, "manuell", 0, now);
    db.close();

    deploy(dbPath);

    const after = new DatabaseSync(dbPath);

    // Keine Ablesung darf sich verändert haben. Das ist die Zusage, die jede
    // dieser Migrationen gibt, und die einzige, deren Bruch niemand bemerkt.
    const werte = after
      .prepare("SELECT id, wert, datum FROM ablesungen ORDER BY id")
      .all()
      .map((row) => `${row.id}:${row.wert}@${row.datum}`)
      .join(",");
    check(
      "keine Ablesung veraendert",
      werte ===
        [
          `a1:100@${ms("2019-05-01")}`,
          `a2:250@${ms("2020-05-01")}`,
          `a3:200@${ms("2024-05-01")}`,
          `a4:5000@${ms("2024-05-01")}`,
        ].join(","),
      werte,
    );

    // Jeder Zähler bekommt sein Standardregister, jede Ablesung den Bezug.
    const register = after
      .prepare("SELECT zaehlerId, obisCode, richtung FROM meter_register ORDER BY zaehlerId")
      .all();
    check("je Zaehler ein Standardregister", register.length === 3, JSON.stringify(register));
    check(
      "alle Standardregister sind Bezug 1.8.0",
      register.every((row) => row.obisCode === "1.8.0" && row.richtung === "BEZUG"),
    );

    const ohneRegister = after
      .prepare("SELECT COUNT(*) AS c FROM ablesungen WHERE registerId IS NULL")
      .get().c;
    check("keine Ablesung ohne Registerbezug", ohneRegister === 0, `${ohneRegister} ohne`);

    // Nur Gaszähler bekommen einen Umrechnungsfaktor.
    const faktoren = after
      .prepare("SELECT zaehlerId, gueltigAb, brennwert, zustandszahl FROM umrechnungsfaktor")
      .all();
    check("nur Gaszaehler bekommen einen Faktor", faktoren.length === 2, JSON.stringify(faktoren));

    const byMeter = Object.fromEntries(faktoren.map((row) => [row.zaehlerId, row]));

    // DER Fall, den die Handprüfung aufgedeckt hat: Ein Zähler mit einer
    // Ablesung von 2019 muss ab 2019 gedeckt sein, nicht erst ab 2021 — sonst
    // gilt sein ältester Verbrauch ab sofort als "unvollständig", und das durch
    // eine Migration, die ausdrücklich nichts verändern soll.
    check(
      "Faktor deckt auch Ablesungen VOR 2021",
      byMeter["gas-alt"]?.gueltigAb === ms("2019-05-01"),
      `gueltigAb=${byMeter["gas-alt"]?.gueltigAb} (erwartet ${ms("2019-05-01")})`,
    );
    check(
      "Zaehler ohne alte Ablesungen starten beim Stichtag",
      byMeter["gas-neu"]?.gueltigAb === ms("2021-01-01T00:00:00Z"),
      `gueltigAb=${byMeter["gas-neu"]?.gueltigAb}`,
    );
    check(
      "Faktor uebernimmt die bisherigen Werte unveraendert",
      byMeter["gas-alt"]?.brennwert === 10.312 && byMeter["gas-alt"]?.zustandszahl === 0.9622,
    );

    // Soft-Delete: alles Bestehende bleibt sichtbar.
    //
    // Nur pruefen, wenn die Spalte da ist. Diese Datei laeuft auch auf einem
    // Stand, auf dem eine spaetere Migration noch fehlt; sie soll dann das
    // pruefen, was existiert, statt an einer Spalte zu scheitern, die es noch
    // nicht gibt.
    const spalten = after
      .prepare("SELECT name FROM pragma_table_info('ablesungen')")
      .all()
      .map((row) => row.name);
    if (spalten.includes("geloeschtAm")) {
      const geloescht = after
        .prepare("SELECT COUNT(*) AS c FROM ablesungen WHERE geloeschtAm IS NOT NULL")
        .get().c;
      check("keine Ablesung gilt nach der Migration als geloescht", geloescht === 0);
    }

    after.close();
  });
}

// ── Fall 3: zweimal anwenden ───────────────────────────────────────────────
// Ein Deploy kann abbrechen und wiederholt werden. Läuft eine
// Daten-Migration dabei zweimal, entstehen doppelte Zeilen — und die fallen
// erst auf, wenn eine Summe nicht mehr stimmt.
function testIdempotence() {
  console.log("\nZweimal anwenden");
  withTempDb((dbPath) => {
    deploy(dbPath, { upTo: migrationNames()[1] });

    const db = new DatabaseSync(dbPath);
    const now = Date.now();
    db.prepare(
      `INSERT INTO zaehler
       (id,name,kategorie,einheit,farbe,icon,aktiv,sortIndex,ableseIntervallTage,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("gas-1", "Gas", "GAS", "m3", "#fff", "flame", 1, 0, 0, now, now);
    db.close();

    deploy(dbPath);
    deploy(dbPath); // der zweite Lauf darf nichts mehr tun

    const after = new DatabaseSync(dbPath);
    check(
      "kein doppeltes Register",
      after.prepare("SELECT COUNT(*) AS c FROM meter_register").get().c === 1,
    );
    check(
      "kein doppelter Faktor",
      after.prepare("SELECT COUNT(*) AS c FROM umrechnungsfaktor").get().c === 1,
    );
    after.close();
  });
}

console.log("Migrationen gegen echte Datenbestaende pruefen");
testFreshDatabase();
testExistingData();
testIdempotence();

console.log(`\n${checks - failures} von ${checks} Pruefungen bestanden.`);
if (failures > 0) {
  console.error(`${failures} fehlgeschlagen.`);
  process.exit(1);
}
