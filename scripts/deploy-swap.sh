#!/bin/sh
# The final container swap of a self-update, run in a DETACHED helper container
# started by scripts/update.sh. Because this container is NOT part of the
# compose project, recreating main-portal doesn't kill it — so it can finish the
# recreate and write the authoritative done/failed status the UI waits for.
#
# Alles Lange (der Build) ist in update.sh passiert, waehrend die alte Anwendung
# noch bediente. HIER passiert das Kurze und das Heikle, in dieser Reihenfolge:
#
#   1. main-portal ANHALTEN
#   2. migrieren
#   3. neue Version hochfahren — oder, wenn 2 scheitert, die alte zurueck
#
# WARUM DAS ANHALTEN SEIN MUSS
#
# Bis v3.12.0-beta.6 lief die Migration neben der laufenden Anwendung, damit ein
# Fehlschlag folgenlos bleibt. Drei Updates sind daran gescheitert. Gemessen,
# auf einer Datenbank im WAL-Modus:
#
#   Anwendung nur verbunden, keine Transaktion  -> migrate deploy laeuft
#   Anwendung mit offener LESEtransaktion       -> gesperrt
#   Anwendung mit offener Schreibtransaktion    -> gesperrt
#
# Auch eine lesende. „Im WAL-Modus stoeren Leser nicht" gilt fuer gewoehnliche
# Schreibvorgaenge, fuer den Schema-Engine von Prisma nicht — und offene
# Transaktionen hat eine laufende Anwendung staendig (das automatische Backup
# liest mit `VACUUM INTO` minutenlang am Stueck). Kein Wiederholungsbudget
# behebt das, es verlaengert nur das Warten: zuletzt 30 Versuche, drei Minuten,
# alle abgewiesen.
#
# Der Preis ist eine kurze Auszeit statt gar keiner. Die Zusicherung aus #108
# bleibt erhalten, nur anders eingeloest: Scheitert die Migration, faehrt dieser
# Deployer die ALTE Version wieder hoch — altes Image, alter Arbeitsbaum —
# statt die neue auf eine unmigrierte Datenbank zu lassen.
set -u

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"
STATUS_FILE="${UPDATE_STATUS_FILE:-/data/update-status.json}"
HISTORY_FILE="${DEPLOY_HISTORY_FILE:-/data/deploy-history.jsonl}"
UPDATE_MODE="${UPDATE_MODE:-update}"
UPDATE_REF="${UPDATE_REF:-}"
UPDATE_LABEL="${UPDATE_LABEL:-}"
UPDATE_CHANNEL="${UPDATE_CHANNEL:-stable}"
# Von update.sh gereicht. Die Vorgaben gelten nur fuer einen Handstart dieses
# Skripts; im Regelfall setzt sie der Aufrufer.
NEEDS_MIGRATION="${NEEDS_MIGRATION:-0}"
IMAGE_TAG="${IMAGE_TAG:-zaehlwerk-main-portal:latest}"
PREV_IMAGE="${PREV_IMAGE:-zaehlwerk-main-portal:previous}"
PREV_HEAD="${PREV_HEAD:-}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zaehlwerk}"

# Append (never truncate) so the live log keeps the whole story across the swap.
exec >>"$LOG_FILE" 2>&1

# Two clocks, one instant, two audiences.
#   now()     — UTC, ISO 8601 with Z. Goes into the status JSON, where the client
#               parses it and formats it locally. Must stay unambiguous.
#   log_now() — local time with its zone name, for the lines a human reads in the
#               live log. A German operator reading UTC timestamps reasonably
#               concludes the server's clock is wrong when it is not.
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log_now() { date +'%Y-%m-%d %H:%M:%S %Z'; }
# Same shape as update.sh's, including `mode` and `startedAt` — this process
# writes the FINAL status, and dropping either here would make the run lose its
# identity and its duration at exactly the moment they are reported. Both are
# handed over as environment variables because this container is a new process:
# it is deliberately outside the compose project so recreating main-portal does
# not kill it, so it inherits nothing.
write_status() {
  printf '{"stage":"%s","ok":%s,"done":%s,"message":"%s","error":"%s","targetSha":"%s","mode":"%s","startedAt":"%s","updatedAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "${UPDATE_MODE:-update}" "${UPDATE_STARTED_AT:-}" "$(now)" >"$STATUS_FILE" 2>/dev/null || true
}

# Append one JSON Lines record of what just went live. This is the list the
# rollback UI offers, so it is written HERE — at the only moment we know the swap
# actually succeeded, from the one container that survives it.
#
# Appended, never rewritten: a read-modify-write on a JSON array would have to be
# done by this `sh` with no jq available, on the one file that must outlive the
# deploy. A torn append costs a single line, which the parser skips.
#
# The label is sanitised app-side (see sanitizeDeployLabel) because printf does
# no escaping — quotes or a newline here would corrupt the record.
record_deploy() {
  [ -n "${GIT_SHA:-}" ] || return 0
  printf '{"at":"%s","sha":"%s","ref":"%s","label":"%s","channel":"%s","mode":"%s"}\n' \
    "$(now)" "$GIT_SHA" "$UPDATE_REF" "$UPDATE_LABEL" "$UPDATE_CHANNEL" "$UPDATE_MODE" \
    >>"$HISTORY_FILE" 2>/dev/null || true
}

# Run from the repo root (this script lives in <repo>/scripts). The caller mounts
# the repo at its real HOST path and sets that as the workdir, so compose's
# `.:/repo` bind resolves correctly on the host daemon.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR" || {
  write_status failed false true "Deployer: Repo-Verzeichnis nicht gefunden" "" "${GIT_SHA:-}"
  exit 1
}
echo "[deploy] repo dir: $REPO_DIR"

# ── Die alte Version zurueckholen ──────────────────────────────────────────
# Der Weg zurueck, wenn die Migration scheitert, nachdem die Anwendung schon
# steht. Drei Dinge muessen zusammenpassen, sonst laeuft die NEUE Anwendung auf
# einer unmigrierten Datenbank — genau der Zustand, den #108 verhindern soll:
#
#   1. das alte Image wieder unter `:latest` (compose startet nach diesem Tag)
#   2. der Arbeitsbaum auf dem alten Stand (sonst luegt die Versionsanzeige,
#      siehe restore_checkout in update.sh)
#   3. hochfahren
#
# Fehlt das alte Image (allererster Deploy), bleibt nur das Hochfahren dessen,
# was da ist — dann gab es aber auch keine Version, die vorher lief.
restore_previous() {
  echo "[deploy] hole die vorherige Version zurueck"
  if docker image inspect "$PREV_IMAGE" >/dev/null 2>&1; then
    docker tag "$PREV_IMAGE" "$IMAGE_TAG" \
      || echo "[deploy] WARNUNG: $PREV_IMAGE liess sich nicht auf $IMAGE_TAG legen" >&2
  else
    echo "[deploy] WARNUNG: kein $PREV_IMAGE vorhanden — starte, was da ist" >&2
  fi

  if [ -n "$PREV_HEAD" ]; then
    git checkout --detach --force "$PREV_HEAD" >/dev/null 2>&1 \
      || echo "[deploy] WARNUNG: Arbeitsbaum blieb auf dem neuen Stand" >&2
  fi

  docker compose -f "$COMPOSE_FILE" up -d --no-build \
    && echo "[deploy] vorherige Version laeuft wieder" \
    || echo "[deploy] WARNUNG: die vorherige Version kam nicht hoch" >&2
  # Versucht — ob geglueckt oder nicht, der Notausgang soll es nicht ein
  # zweites Mal probieren.
  STOPPED=0
}

# ── Notausgang ─────────────────────────────────────────────────────────────
# Zwischen „angehalten" und „wieder hochgefahren" liegt das einzige Fenster,
# in dem diese Instanz keine Anwendung hat. Stirbt der Deployer genau dort —
# OOM, Neustart des Hosts, ein Signal —, bliebe sie unten: `stop` schaltet auch
# `restart: unless-stopped` ab, es kommt also von selbst nichts zurueck.
#
# Deshalb ein Trap. Er greift nur, wenn angehalten wurde und der regulaere Weg
# das Hochfahren nicht mehr erreicht hat; im Normalfall ist STOPPED wieder 0 und
# hier passiert nichts. Lieber die alte Version unerwartet laufen als gar keine.
STOPPED=0
notausgang() {
  [ "$STOPPED" = "1" ] || return 0
  echo "[deploy] NOTAUSGANG: abgebrochen, waehrend die Anwendung stand — fahre hoch" >&2
  docker compose -f "$COMPOSE_FILE" up -d --no-build >/dev/null 2>&1 || true
}
trap notausgang EXIT HUP INT TERM

# ── 1) Anwendung anhalten ──────────────────────────────────────────────────
# Nur main-portal. Caddy bleibt stehen und liefert weiter eine Fehlerseite
# statt einer toten Verbindung — das ist der freundlichere Ausfall.
if [ "$NEEDS_MIGRATION" = "1" ]; then
  echo "[deploy] $(log_now) halte main-portal an (die Migration braucht die Datenbank allein)"
  write_status migrating true false "Anwendung wird kurz angehalten" "" "${GIT_SHA:-}"
  STOPPED=1
  docker compose -f "$COMPOSE_FILE" stop main-portal \
    || echo "[deploy] WARNUNG: main-portal liess sich nicht anhalten — migriere trotzdem" >&2

  # ── 2) Migrieren ─────────────────────────────────────────────────────────
  # Ohne --build: Das Image steht seit update.sh. Der Layer-Export dauert
  # Minuten, und die gehoeren nicht in das Fenster, in dem nichts bedient.
  echo "[deploy] migriere die Datenbank"
  write_status migrating true false "Datenbank wird migriert" "" "${GIT_SHA:-}"
  if ! GIT_SHA="${GIT_SHA:-}" docker compose -f "$COMPOSE_FILE" --profile tools run --rm db-migrate; then
    echo "[deploy] MIGRATION FEHLGESCHLAGEN $(log_now)"
    restore_previous
    write_status failed false true \
      "DB-Migration fehlgeschlagen – die vorherige Version läuft weiter" "" "${GIT_SHA:-}"
    exit 1
  fi
  echo "[deploy] Migration durch"
fi

# ── 3) Neue Version hochfahren ─────────────────────────────────────────────
echo "[deploy] $(log_now) recreating main-portal (compose up -d --no-build)"
write_status restarting true false "Anwendung wird gestartet" "" "${GIT_SHA:-}"

# --no-build: the image was already built in update.sh; this is just the swap.
if docker compose -f "$COMPOSE_FILE" up -d --no-build; then
  STOPPED=0
  echo "[deploy] swap complete $(log_now)"
  record_deploy
  if [ "$UPDATE_MODE" = "rollback" ]; then
    write_status done true true "Rollback abgeschlossen" "" "${GIT_SHA:-}"
  else
    write_status done true true "Update abgeschlossen" "" "${GIT_SHA:-}"
  fi
else
  echo "[deploy] swap FAILED $(log_now)"
  # Hier NICHT zurueckrollen: Die Migration ist durch, die Datenbank traegt das
  # neue Schema. Die alte Anwendung darauf zu starten waere schlechter als der
  # ehrliche Fehlschlag — sie kennt die neuen Spalten nicht.
  write_status failed false true "Neustart fehlgeschlagen – Details im Log" "" "${GIT_SHA:-}"
fi
