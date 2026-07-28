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

import { execFileSync, spawn } from "node:child_process";
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
// Dieselbe Baseline, die `deploy-migrations.sh` stempelt.
const BASELINE = "0_init";

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

/**
 * Auf eine Zeile aus einem Kindprozess warten — der Handschlag statt eines
 * geratenen `setTimeout`. Liefert false, wenn sie bis `timeoutMs` ausbleibt
 * oder der Prozess vorher endet; der Aufrufer entscheidet, was das bedeutet.
 */
function waitForLine(child, needle, timeoutMs) {
  return new Promise((resolve) => {
    let buffer = "";
    const finish = (value) => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      resolve(value);
    };
    const onData = (chunk) => {
      buffer += chunk;
      if (buffer.includes(needle)) finish(true);
    };
    const onExit = () => finish(buffer.includes(needle));
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
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

// ── Fall 4: Datenbank ist gesperrt ─────────────────────────────────────────
// Die Migration laeuft, WAEHREND die alte Anwendung weiterlaeuft und schreibt.
// Der Schema-Engine von Prisma kennt kein `busy_timeout` und gibt beim ersten
// Zusammentreffen sofort auf — eine Ablesung im falschen Moment genuegte, um
// ein Update zu Fall zu bringen. Genau das ist passiert.
//
// Dieser Fall prueft das SKRIPT, nicht die CLI: Nur `deploy-migrations.sh`
// kennt die Wiederholung.
async function testLockedDatabase() {
  console.log("\nGesperrte Datenbank (laufende Anwendung schreibt)");
  await withTempDb(async (dbPath) => {
    deploy(dbPath, { upTo: migrationNames()[1] });

    // Ein zweiter Prozess mit offener Schreibtransaktion — die Anwendung,
    // die gerade eine Ablesung speichert.
    //
    // Zwei Details, ohne die dieser Fall still durchrutscht:
    //
    //   * Er MELDET sich, sobald der INSERT durch ist. Erst dann steht die
    //     Schreibsperre wirklich. Vorher einfach ein paar Sekunden zu warten
    //     hiess: mal gesperrt, mal nicht — und wenn nicht, bestand der Test,
    //     ohne die Wiederholung je ausgeloest zu haben.
    //   * Die Transaktion bekommt ein ausdrueckliches `timeout`. Prisma bricht
    //     interaktive Transaktionen sonst nach 5s ab; die Sperre war dann weg,
    //     bevor `migrate deploy` ueberhaupt an die Reihe kam.
    //
    // Gehalten wird HOLD_MS — lang genug fuer mehrere Wiederholungen, kurz
    // genug, dass die Migration danach noch in ihr Budget passt.
    const HOLD_MS = 12_000;
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `import("${path.join(PACKAGE_ROOT, "generated/client/index.js")}").then(async ({ PrismaClient }) => {
           const db = new PrismaClient({ datasourceUrl: "file:${dbPath}" });
           await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
           await db.$transaction(async (tx) => {
             await tx.$executeRawUnsafe("INSERT INTO locations (id,name,createdAt) VALUES ('lock','lock',0)");
             console.log("LOCKED");
             await new Promise((r) => setTimeout(r, ${HOLD_MS}));
           }, { timeout: ${HOLD_MS + 10_000}, maxWait: 10_000 }).catch(() => {});
           await db.$disconnect();
           process.exit(0);
         })`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    const gesperrt = await waitForLine(holder, "LOCKED", 20_000);
    check("Halter haelt die Schreibsperre", gesperrt, "Vorbedingung des Falls nicht hergestellt");

    let ok = true;
    let output = "";
    try {
      output = execFileSync("sh", ["scripts/deploy-migrations.sh"], {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${dbPath}`, LOCK_WAIT: "3" },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      ok = false;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    } finally {
      holder.kill();
    }

    check("Skript gibt bei einer Sperre nicht sofort auf", /gesperrt — Versuch/.test(output),
      "keine Wiederholung im Log — wartet das Skript wirklich?");
    check("Migration laeuft nach dem Warten durch", ok, output.slice(-400));

    if (ok) {
      const spalten = (await query(dbPath, "SELECT name FROM pragma_table_info('ablesungen')")).map(
        (row) => row.name,
      );
      check("alle Migrationen sind angekommen", spalten.includes("geloeschtAm"));
    }
  });
}

// ── Fall 5: Baseline wird nicht zweimal gestempelt ─────────────────────────
// Der eigentliche Ausloeser: Das Skript stempelte bei JEDEM Update, obwohl die
// Baseline nur einmal im Leben noetig ist. Jeder dieser Aufrufe nahm grundlos
// einen Schreiblock — die haeufigste Gelegenheit fuer die Kollision oben.
async function testBaselineStampedOnce() {
  console.log("\nBaseline nur beim ersten Mal stempeln");
  await withTempDb(async (dbPath) => {
    // Der echte Ausgangszustand: alle Tabellen aus der Zeit vor Prisma Migrate,
    // aber KEINE `_prisma_migrations`. Nur so laeuft der Stempel-Zweig wirklich
    // an — mit `deploy()` waere die Baseline schon vermerkt und der Test
    // pruefte den Fall gar nicht, den er beschreibt.
    prismaCli([
      "db",
      "execute",
      "--file",
      path.join(MIGRATIONS_DIR, BASELINE, "migration.sql"),
      "--url",
      `file:${dbPath}`,
    ]);

    const run = () =>
      execFileSync("sh", ["scripts/deploy-migrations.sh"], {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
        encoding: "utf8",
        stdio: "pipe",
      });

    const erster = run();
    check(
      "stempelt die fehlende Baseline beim ersten Lauf",
      /wird einmalig gestempelt/.test(erster),
      erster.slice(-300),
    );

    const zweiter = run();
    check(
      "erkennt die bereits vermerkte Baseline",
      /Baseline ist bereits vermerkt/.test(zweiter),
      zweiter.slice(-300),
    );
    check("stempelt nicht erneut", !/wird einmalig gestempelt/.test(zweiter));
  });
}

// ── Fall 6: Datenbank ohne WAL, lang lesende Anwendung ─────────────────────
// DER Fall, an dem das Update wirklich gescheitert ist. Fall 4 hat ihn nicht
// gefunden, weil der Halter dort selbst auf WAL stellte.
//
// Entscheidend ist nicht „ein Leser", sondern ein LANGE OFFENER Leser. Kurze
// Abfragen geben die Sperre zwischen den Anweisungen frei, da findet ein
// Schreiber immer eine Luecke — das wurde nachgemessen, der Fall besteht auch
// ohne Fix. Eine lange Lesetransaktion tut das nicht: Im `delete`-Modus sperrt
// sie die ganze Datei ueber ihre volle Laufzeit gegen jeden Schreiber.
//
// Genau so eine laeuft hier regelmaessig: `VACUUM INTO` des automatischen
// Backups liest die Quelle waehrend der kompletten Kopie. Trifft eine Migration
// darauf, hilft Wiederholen NICHT — jeder Versuch wird abgewiesen, bis das
// Budget alle ist. Nachgestellt und bestaetigt, mit demselben Fehlerbild wie im
// Protokoll der Instanz.
//
// Der Ausweg ist der WAL-Modus: Dort stoeren Leser Schreiber ueberhaupt nicht.
// `ensure-wal.mjs` stellt deshalb VOR der Migration um.
//
// Was dieser Wechsel NICHT kann: einen bereits laufenden Leser aussitzen.
// SQLite gibt bei einem Moduswechsel sofort SQLITE_BUSY zurueck, ohne den
// Busy-Handler zu fragen — ein `busy_timeout` aendert daran nichts, das wurde
// gemessen. Der Wechsel gelingt nur auf einer im Moment freien Datenbank.
//
// Deshalb zwei getrennte Faelle statt eines vermischten:
//   6a  freie Datenbank  -> der Wechsel gelingt, und ab dann ist Ruhe
//   6b  langer Leser     -> das Budget der Wiederholung traegt ihn aus
async function testWalSwitchOnQuietDatabase() {
  console.log("\nDatenbank ohne WAL, frei");
  await withTempDb(async (dbPath) => {
    deploy(dbPath, { upTo: migrationNames()[1] });

    // Zurueck in den Standardmodus — so sieht eine Instanz aus, auf der das
    // Umstellen beim Start nie geklappt hat.
    await query(dbPath, "PRAGMA journal_mode = DELETE");
    const vorher = (await query(dbPath, "PRAGMA journal_mode"))[0].journal_mode;
    check("Ausgangslage: kein WAL", String(vorher).toLowerCase() === "delete", String(vorher));

    const output = execFileSync("sh", ["scripts/deploy-migrations.sh"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      encoding: "utf8",
      stdio: "pipe",
    });

    check("Skript stellt auf WAL um", /\[wal\].*auf wal umgestellt/.test(output), output.slice(-300));

    const nachher = (await query(dbPath, "PRAGMA journal_mode"))[0].journal_mode;
    check("Modus steht dauerhaft in der Datei", String(nachher).toLowerCase() === "wal", String(nachher));
  });
}

async function testLongReaderOnNonWalDatabase() {
  console.log("\nDatenbank ohne WAL, lang lesende Anwendung (Backup)");
  await withTempDb(async (dbPath) => {
    deploy(dbPath, { upTo: migrationNames()[1] });
    await query(dbPath, "PRAGMA journal_mode = DELETE");

    // Modell fuer `VACUUM INTO` des automatischen Backups: eine Lesetransaktion,
    // die ueber die ganze Kopie offen bleibt. Kurze Einzelabfragen taeten es
    // NICHT — die geben die Sperre zwischen den Anweisungen frei, und der Fall
    // bestuende auch ohne Fix. Nachgemessen.
    const HOLD_MS = 12_000;
    const reader = spawn(
      process.execPath,
      [
        "-e",
        `import("${path.join(PACKAGE_ROOT, "generated/client/index.js")}").then(async ({ PrismaClient }) => {
           const db = new PrismaClient({ datasourceUrl: "file:${dbPath}" });
           await db.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
           await db.$transaction(async (tx) => {
             await tx.$queryRawUnsafe("SELECT COUNT(*) AS c FROM ablesungen");
             console.log("READING");
             await new Promise((r) => setTimeout(r, ${HOLD_MS}));
           }, { timeout: ${HOLD_MS + 15_000}, maxWait: 10_000 }).catch(() => {});
           await db.$disconnect();
           process.exit(0);
         })`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    const laeuft = await waitForLine(reader, "READING", 20_000);
    check("Leser haelt eine offene Lesetransaktion", laeuft, "Vorbedingung nicht hergestellt");

    let ok = true;
    let output = "";
    try {
      output = execFileSync("sh", ["scripts/deploy-migrations.sh"], {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${dbPath}`, LOCK_WAIT: "3" },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      ok = false;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    } finally {
      reader.kill();
    }

    // Der Kern: Das Skript darf hier NICHT aufgeben. Ohne das Budget bricht es
    // ab — genau das Fehlerbild aus dem Protokoll der Instanz.
    check("wartet den Leser aus, statt aufzugeben", /gesperrt — Versuch/.test(output), output.slice(-300));
    check("Migration laeuft trotz offener Lesetransaktion durch", ok, output.slice(-600));

    if (ok) {
      const spalten = (await query(dbPath, "SELECT name FROM pragma_table_info('ablesungen')")).map(
        (row) => row.name,
      );
      check("alle Migrationen sind angekommen", spalten.includes("geloeschtAm"));
    }
  });
}

console.log("Migrationen gegen echte Datenbestaende pruefen");
await testFreshDatabase();
await testExistingData();
await testIdempotence();
await testLockedDatabase();
await testBaselineStampedOnce();
await testWalSwitchOnQuietDatabase();
await testLongReaderOnNonWalDatabase();

console.log(`\n${checks - failures} von ${checks} Pruefungen bestanden.`);
if (failures > 0) {
  console.error(`${failures} fehlgeschlagen.`);
  process.exit(1);
}
