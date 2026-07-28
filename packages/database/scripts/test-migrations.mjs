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
 * Bewusst ohne Test-Framework und mit ROHEM SQL: Der Sinn ist, die Migrationen
 * so anzuwenden, wie der Deploy es tut — mit der Prisma-CLI, gegen eine Datei —
 * und danach den Zustand der DATENBANK anzusehen. Über die Modelle des Clients
 * zu lesen prüfte die Sicht des ORM, nicht die Tabellen.
 *
 * Der Client dient hier nur als Treiber (`$queryRawUnsafe`). `node:sqlite` wäre
 * naheliegender, gibt es aber erst ab Node 22 — und dieses Projekt läuft auf
 * Node 20, im Container wie in CI. Die Prüfung darf nicht auf einer anderen
 * Laufzeit stattfinden als die Anwendung.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
// Der generierte Client liegt neben dem Schema (`generator.output`), nicht
// unter @prisma/client — der Standardpfad meldet sonst „did not initialize yet".
import { PrismaClient } from "../generated/client/index.js";
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

function prismaCli(args, extraEnv = {}) {
  return execFileSync("pnpm", ["exec", "prisma", ...args], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: "pipe",
    encoding: "utf8",
  });
}

function deploy(dbPath, { upTo } = {}) {
  const url = `file:${dbPath}`;
  if (!upTo) {
    prismaCli(["migrate", "deploy"], { DATABASE_URL: url });
    return;
  }

  // `upTo` gibt es in Prisma nicht. Um einen Zwischenstand herzustellen, wird
  // jede Migration bis dorthin einzeln eingespielt und danach als angewendet
  // gestempelt — derselbe Weg, den `deploy-migrations.sh` fuer den Einstieg in
  // eine bestehende Installation benutzt.
  const names = migrationNames();
  const stopAt = names.indexOf(upTo);
  if (stopAt === -1) throw new Error(`Unbekannte Migration: ${upTo}`);

  for (const name of names.slice(0, stopAt)) {
    prismaCli([
      "db",
      "execute",
      "--file",
      path.join(MIGRATIONS_DIR, name, "migration.sql"),
      "--url",
      url,
    ]);
    prismaCli(["migrate", "resolve", "--applied", name], { DATABASE_URL: url });
  }
}

/** Rohes SQL gegen die Datei — der Client ist hier nur der Treiber. */
async function query(dbPath, sql) {
  const client = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    return await client.$queryRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

/** Wie `query`, aber fuer schreibende Anweisungen (Testdaten anlegen). */
async function execute(dbPath, sql, params = []) {
  const client = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    await client.$executeRawUnsafe(sql, ...params);
  } finally {
    await client.$disconnect();
  }
}

async function withTempDb(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "zw-migrate-"));
  const dbPath = path.join(dir, "test.db");
  try {
    return await fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ms = (iso) => new Date(iso).getTime();

// ── Fall 1: leere Datenbank ────────────────────────────────────────────────
// Der einfachste Fall, und der einzige, den ein Deploy auf einer neuen Instanz
// je sieht. Er beweist nicht viel, aber sein Fehlschlag ist eindeutig.
async function testFreshDatabase() {
  console.log("\nLeere Datenbank");
  await withTempDb(async (dbPath) => {
    deploy(dbPath);

    const tables = (
      await query(dbPath, "SELECT name FROM sqlite_master WHERE type='table'")
    ).map((row) => row.name);

    for (const expected of ["zaehler", "ablesungen", "meter_register", "umrechnungsfaktor"]) {
      check(`Tabelle ${expected} vorhanden`, tables.includes(expected));
    }

    const applied = Number(
      (await query(dbPath, "SELECT COUNT(*) AS c FROM _prisma_migrations WHERE finished_at IS NOT NULL"))[0].c,
    );
    check(
      "alle Migrationen als angewendet vermerkt",
      applied === migrationNames().length,
      `${applied} von ${migrationNames().length}`,
    );
  });
}

// ── Fall 2: Bestand mit Daten ──────────────────────────────────────────────
// Der Fall, der zählt. Die Datenbank wird auf den Stand VOR den datenverändernden
// Migrationen gebracht, mit Zeilen gefüllt und dann hochgezogen.
async function testExistingData() {
  console.log("\nBestehende Installation mit Daten");
  await withTempDb(async (dbPath) => {
    // Stand direkt nach der Baseline — so sah jede Installation vor v3 aus.
    deploy(dbPath, { upTo: migrationNames()[1] });

    const now = Date.now();
    for (const [id, name, kategorie, einheit] of [
      ["gas-alt", "Gas alt", "GAS", "m3"],
      ["gas-neu", "Gas neu", "GAS", "m3"],
      ["strom", "Strom", "STROM", "kWh"],
    ]) {
      await execute(
        dbPath,
        `INSERT INTO zaehler
         (id,name,kategorie,einheit,farbe,icon,aktiv,sortIndex,ableseIntervallTage,createdAt,updatedAt)
         VALUES (?,?,?,?,'#fff','flame',1,0,0,?,?)`,
        [id, name, kategorie, einheit, now, now],
      );
    }

    // Eine Ablesung VOR 2021 — der Fall, an dem die Faktor-Migration hing.
    for (const [id, zaehlerId, iso, wert] of [
      ["a1", "gas-alt", "2019-05-01", 100],
      ["a2", "gas-alt", "2020-05-01", 250],
      ["a3", "gas-neu", "2024-05-01", 200],
      ["a4", "strom", "2024-05-01", 5000],
    ]) {
      await execute(
        dbPath,
        `INSERT INTO ablesungen
         (id,zaehlerId,datum,wert,zaehlerGetauscht,quelle,istAbgerechnet,createdAt)
         VALUES (?,?,?,?,0,'manuell',0,?)`,
        [id, zaehlerId, ms(iso), wert, now],
      );
    }

    deploy(dbPath);

    // Keine Ablesung darf sich verändert haben. Das ist die Zusage, die jede
    // dieser Migrationen gibt, und die einzige, deren Bruch niemand bemerkt.
    const werte = (await query(dbPath, "SELECT id, wert, datum FROM ablesungen ORDER BY id"))
      .map((row) => `${row.id}:${row.wert}@${Number(row.datum)}`)
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
    const register = await query(
      dbPath,
      "SELECT zaehlerId, obisCode, richtung FROM meter_register ORDER BY zaehlerId",
    );
    check("je Zaehler ein Standardregister", register.length === 3, JSON.stringify(register));
    check(
      "alle Standardregister sind Bezug 1.8.0",
      register.every((row) => row.obisCode === "1.8.0" && row.richtung === "BEZUG"),
    );

    const ohneRegister = Number(
      (await query(dbPath, "SELECT COUNT(*) AS c FROM ablesungen WHERE registerId IS NULL"))[0].c,
    );
    check("keine Ablesung ohne Registerbezug", ohneRegister === 0, `${ohneRegister} ohne`);

    // Nur Gaszähler bekommen einen Umrechnungsfaktor.
    const faktoren = await query(
      dbPath,
      "SELECT zaehlerId, gueltigAb, brennwert, zustandszahl FROM umrechnungsfaktor",
    );
    check("nur Gaszaehler bekommen einen Faktor", faktoren.length === 2, JSON.stringify(faktoren));

    const byMeter = Object.fromEntries(faktoren.map((row) => [row.zaehlerId, row]));
    const gueltigAb = (id) => Number(byMeter[id]?.gueltigAb ?? new Date(byMeter[id]?.gueltigAb));

    // DER Fall, den die Handprüfung aufgedeckt hat: Ein Zähler mit einer
    // Ablesung von 2019 muss ab 2019 gedeckt sein, nicht erst ab 2021 — sonst
    // gilt sein ältester Verbrauch ab sofort als "unvollständig", und das durch
    // eine Migration, die ausdrücklich nichts verändern soll.
    check(
      "Faktor deckt auch Ablesungen VOR 2021",
      gueltigAb("gas-alt") === ms("2019-05-01"),
      `gueltigAb=${gueltigAb("gas-alt")} (erwartet ${ms("2019-05-01")})`,
    );
    check(
      "Zaehler ohne alte Ablesungen starten beim Stichtag",
      gueltigAb("gas-neu") === ms("2021-01-01T00:00:00Z"),
      `gueltigAb=${gueltigAb("gas-neu")}`,
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
    const spalten = (await query(dbPath, "SELECT name FROM pragma_table_info('ablesungen')")).map(
      (row) => row.name,
    );
    if (spalten.includes("geloeschtAm")) {
      const geloescht = Number(
        (await query(dbPath, "SELECT COUNT(*) AS c FROM ablesungen WHERE geloeschtAm IS NOT NULL"))[0].c,
      );
      check("keine Ablesung gilt nach der Migration als geloescht", geloescht === 0);
    }
  });
}

// ── Fall 3: zweimal anwenden ───────────────────────────────────────────────
// Ein Deploy kann abbrechen und wiederholt werden. Läuft eine Daten-Migration
// dabei zweimal, entstehen doppelte Zeilen — und die fallen erst auf, wenn eine
// Summe nicht mehr stimmt.
async function testIdempotence() {
  console.log("\nZweimal anwenden");
  await withTempDb(async (dbPath) => {
    deploy(dbPath, { upTo: migrationNames()[1] });

    const now = Date.now();
    await execute(
      dbPath,
      `INSERT INTO zaehler
       (id,name,kategorie,einheit,farbe,icon,aktiv,sortIndex,ableseIntervallTage,createdAt,updatedAt)
       VALUES ('gas-1','Gas','GAS','m3','#fff','flame',1,0,0,?,?)`,
      [now, now],
    );

    deploy(dbPath);
    deploy(dbPath); // der zweite Lauf darf nichts mehr tun

    const register = Number(
      (await query(dbPath, "SELECT COUNT(*) AS c FROM meter_register"))[0].c,
    );
    const faktoren = Number(
      (await query(dbPath, "SELECT COUNT(*) AS c FROM umrechnungsfaktor"))[0].c,
    );
    check("kein doppeltes Register", register === 1, `${register}`);
    check("kein doppelter Faktor", faktoren === 1, `${faktoren}`);
  });
}

console.log("Migrationen gegen echte Datenbestaende pruefen");
await testFreshDatabase();
await testExistingData();
await testIdempotence();

console.log(`\n${checks - failures} von ${checks} Pruefungen bestanden.`);
if (failures > 0) {
  console.error(`${failures} fehlgeschlagen.`);
  process.exit(1);
}
