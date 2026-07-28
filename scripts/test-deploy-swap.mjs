#!/usr/bin/env node
/**
 * deploy-swap.sh pruefen — das Skript, das die Anwendung anhaelt, migriert und
 * wieder hochfaehrt.
 *
 * Es ist das riskanteste im Projekt: Es laeuft abgekoppelt, es fasst Container
 * an, und wenn es in der Mitte falsch abbiegt, steht die Instanz ohne
 * Anwendung. Genau dafuer gab es bisher keinen Test — die Fehler wurden auf
 * der echten Instanz gefunden, dreimal hintereinander.
 *
 * Gebaut wird hier kein Docker. Auf dem PATH liegt ein NACHGEMACHTES `docker`,
 * das jeden Aufruf mitschreibt und auf Wunsch scheitert. Geprueft wird damit
 * genau das, was das Skript selbst entscheidet: die REIHENFOLGE der Schritte
 * und der Weg zurueck, wenn die Migration scheitert. Ob Docker seinerseits tut,
 * was man ihm sagt, ist nicht Gegenstand dieses Tests.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SWAP_SCRIPT = path.join(HERE, "deploy-swap.sh");

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
 * Eine Spielwiese: ein echtes Mini-Repo mit zwei Commits (damit `PREV_HEAD`
 * ein echter Stand ist, den `git checkout` finden kann) und ein `docker`, das
 * nur protokolliert.
 *
 * `failOn` ist ein Textstueck; passt es auf die Argumente, endet der
 * nachgemachte Aufruf mit 1. So wird eine gescheiterte Migration erzeugt, ohne
 * dass irgendetwas Echtes scheitern muss.
 */
function playground({ failOn = null, missingPrevImage = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "zw-swap-"));
  const repo = path.join(dir, "repo");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });

  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "marker"), "alt\n");
  git("add", "-A");
  git("commit", "-q", "-m", "alt");
  const prevHead = String(git("rev-parse", "HEAD")).trim();
  writeFileSync(path.join(repo, "marker"), "neu\n");
  git("add", "-A");
  git("commit", "-q", "-m", "neu");

  // Das zu pruefende Skript an seinen erwarteten Platz kopieren: Es leitet
  // REPO_DIR aus dem eigenen Ort ab.
  writeFileSync(path.join(repo, "scripts", "deploy-swap.sh"), readFileSync(SWAP_SCRIPT));
  writeFileSync(path.join(repo, "docker-compose.prod.yml"), "services: {}\n");

  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const calls = path.join(dir, "docker-calls.log");
  writeFileSync(
    path.join(bin, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(calls)}
# 'image inspect' beantwortet die Frage, ob ein Image existiert.
case "$*" in
  "image inspect "*)
    ${missingPrevImage ? 'case "$*" in *previous*) exit 1 ;; esac' : ":"}
    exit 0 ;;
esac
${failOn ? `case "$*" in *${failOn}*) exit 1 ;; esac` : ""}
exit 0
`,
  );
  chmodSync(path.join(bin, "docker"), 0o755);

  return { dir, repo, bin, calls, prevHead, git };
}

function runSwap(pg, env = {}) {
  const statusFile = path.join(pg.dir, "update-status.json");
  const logFile = path.join(pg.dir, "update.log");
  const historyFile = path.join(pg.dir, "deploy-history.jsonl");

  let exitCode = 0;
  try {
    execFileSync("sh", [path.join(pg.repo, "scripts", "deploy-swap.sh")], {
      cwd: pg.repo,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${pg.bin}:${process.env.PATH}`,
        UPDATE_STATUS_FILE: statusFile,
        UPDATE_LOG_FILE: logFile,
        DEPLOY_HISTORY_FILE: historyFile,
        GIT_SHA: "deadbeef",
        UPDATE_MODE: "update",
        UPDATE_REF: "v9.9.9",
        UPDATE_LABEL: "Test",
        UPDATE_CHANNEL: "beta",
        PREV_HEAD: pg.prevHead,
        NEEDS_MIGRATION: "1",
        ...env,
      },
    });
  } catch (error) {
    exitCode = error.status ?? 1;
  }

  const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  return {
    exitCode,
    calls: read(pg.calls).trim().split("\n").filter(Boolean),
    log: read(logFile),
    status: read(statusFile).trim() ? JSON.parse(read(statusFile).trim().split("\n").pop()) : null,
    history: read(historyFile).trim().split("\n").filter(Boolean),
    marker: read(path.join(pg.repo, "marker")).trim(),
  };
}

/** Index des ersten Aufrufs, der `needle` enthaelt — oder -1. */
const at = (calls, needle) => calls.findIndex((call) => call.includes(needle));

// ── Fall 1: alles geht gut ─────────────────────────────────────────────────
// Die Reihenfolge IST die Zusicherung. Migrieren, bevor angehalten wurde, ist
// genau der Zustand, an dem drei Updates gescheitert sind.
function testHappyPath() {
  console.log("\nMigration geht durch");
  const pg = playground();
  const run = runSwap(pg);

  const stop = at(run.calls, "stop main-portal");
  const migrate = at(run.calls, "run --rm db-migrate");
  const up = at(run.calls, "up -d --no-build");

  check("haelt die Anwendung an", stop !== -1, run.calls.join(" | "));
  check("migriert danach, nicht davor", stop !== -1 && migrate > stop, `stop=${stop} migrate=${migrate}`);
  check("faehrt erst nach der Migration hoch", migrate !== -1 && up > migrate, `migrate=${migrate} up=${up}`);
  check("baut im Migrationsschritt nicht mehr", !run.calls.some((c) => c.includes("run --rm --build")));
  check("meldet Erfolg", run.status?.stage === "done" && run.status?.ok === true, JSON.stringify(run.status));
  check("schreibt einen Eintrag in die Deploy-Historie", run.history.length === 1, run.history.join(" | "));
  check("laesst den Arbeitsbaum auf dem neuen Stand", run.marker === "neu", run.marker);

  rmSync(pg.dir, { recursive: true, force: true });
}

// ── Fall 2: die Migration scheitert ────────────────────────────────────────
// Der Fall, der zaehlt. Die Anwendung ist bereits angehalten — jetzt DARF die
// neue Version nicht hochkommen, denn die Datenbank ist unmigriert. Sie muss
// aber IRGENDETWAS hochfahren, sonst steht die Instanz still.
function testMigrationFails() {
  console.log("\nMigration scheitert");
  const pg = playground({ failOn: "db-migrate" });
  const run = runSwap(pg);

  check("endet mit einem Fehlercode", run.exitCode !== 0, `exit=${run.exitCode}`);
  check(
    "legt das alte Image zurueck auf :latest",
    run.calls.some((c) => c.includes("tag zaehlwerk-main-portal:previous zaehlwerk-main-portal:latest")),
    run.calls.join(" | "),
  );
  check("stellt den alten Arbeitsbaum wieder her", run.marker === "alt", run.marker);
  check(
    "faehrt die Instanz wieder hoch",
    at(run.calls, "up -d --no-build") !== -1,
    "ohne das stuende die Instanz nach dem Anhalten still",
  );
  check(
    "meldet den Fehlschlag samt Folge",
    run.status?.stage === "failed" && /vorherige Version/.test(run.status?.message ?? ""),
    JSON.stringify(run.status),
  );
  check(
    "traegt NICHTS in die Deploy-Historie ein",
    run.history.length === 0,
    "die Historie ist die Liste, die der Rollback anbietet — ein nie gelaufener Stand gehoert nicht hinein",
  );

  rmSync(pg.dir, { recursive: true, force: true });
}

// ── Fall 3: Rollback ───────────────────────────────────────────────────────
// Ein Rollback migriert bewusst nicht. Dann gibt es auch keinen Grund, die
// Anwendung anzuhalten — die Auszeit waere grundlos.
function testRollbackSkipsMigration() {
  console.log("\nRollback migriert nicht");
  const pg = playground();
  const run = runSwap(pg, { NEEDS_MIGRATION: "0", UPDATE_MODE: "rollback" });

  check("migriert nicht", at(run.calls, "db-migrate") === -1, run.calls.join(" | "));
  check("haelt die Anwendung nicht an", at(run.calls, "stop main-portal") === -1, run.calls.join(" | "));
  check("faehrt hoch", at(run.calls, "up -d --no-build") !== -1);
  check("meldet Erfolg", run.status?.stage === "done", JSON.stringify(run.status));

  rmSync(pg.dir, { recursive: true, force: true });
}

// ── Fall 4: kein altes Image ───────────────────────────────────────────────
// Der allererste Deploy einer Instanz. Es gibt nichts zurueckzuholen — das
// darf den Weg zurueck nicht sprengen, sonst bleibt die Instanz unten.
function testMissingPreviousImage() {
  console.log("\nMigration scheitert, aber es gibt kein altes Image");
  const pg = playground({ failOn: "db-migrate", missingPrevImage: true });
  const run = runSwap(pg);

  check(
    "legt kein Image zurueck, das es nicht gibt",
    !run.calls.some((c) => c.includes("tag zaehlwerk-main-portal:previous")),
    run.calls.join(" | "),
  );
  check("faehrt trotzdem hoch", at(run.calls, "up -d --no-build") !== -1, run.calls.join(" | "));
  check("sagt im Protokoll, dass etwas fehlt", /kein .*previous/.test(run.log), run.log.slice(-300));

  rmSync(pg.dir, { recursive: true, force: true });
}

console.log("deploy-swap.sh pruefen");
testHappyPath();
testMigrationFails();
testRollbackSkipsMigration();
testMissingPreviousImage();

console.log(`\n${checks - failures} von ${checks} Pruefungen bestanden.`);
if (failures > 0) {
  console.error(`${failures} fehlgeschlagen.`);
  process.exit(1);
}
