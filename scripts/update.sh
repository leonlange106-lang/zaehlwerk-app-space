#!/bin/sh
# Self-update orchestrator for the Zählwerk production deployment.
#
# Triggered by POST /api/update/trigger (runs INSIDE the main-portal container,
# using the mounted /var/run/docker.sock to drive the host's Docker daemon), or
# run by hand on the host: `scripts/update.sh`.
#
# Reliability design (learned the hard way):
#   1. pull      – fast-forward the checkout
#   2. build     – build the NEW image while the OLD app keeps serving
#   3. migrate   – `prisma migrate deploy` as a PRECONDITION: if it fails we
#                  abort here with the old app still running and healthy, so a
#                  schema change can never take the site down again
#   4. hand off  – a DETACHED "deployer" container (started from the new image)
#                  performs the actual `compose up` recreate and writes the
#                  final status. This MUST be a separate container: recreating
#                  main-portal kills THIS script mid-swap, so it cannot reliably
#                  finish the recreate or record "done" itself. That single flaw
#                  is why the old updater hung on "building" forever.
#
# Uses `sh` (not bash) so it runs unmodified inside the slim node:alpine image.
set -u

REPO_ROOT="${REPO_ROOT:-/repo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
# Exact ref to deploy, set by /api/update/trigger from the instance's release
# channel. Empty = follow UPDATE_BRANCH, which is what every run did before
# channels existed and what the stable channel still does while this repo has
# no stable release tags.
UPDATE_REF="${UPDATE_REF:-}"
# "update" (default) or "rollback". A rollback is the same deploy with an older
# ref — with ONE difference, see the migration step: it skips the migration.
UPDATE_MODE="${UPDATE_MODE:-update}"
# Human-readable name of the target and the channel it came from, recorded in
# the deploy history by the deployer. Display text only, never interpreted here.
UPDATE_LABEL="${UPDATE_LABEL:-}"
UPDATE_CHANNEL="${UPDATE_CHANNEL:-stable}"
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"
STATUS_FILE="${UPDATE_STATUS_FILE:-/data/update-status.json}"
# Append-only record of what this instance has deployed; the rollback UI reads it.
DEPLOY_HISTORY_FILE="${DEPLOY_HISTORY_FILE:-/data/deploy-history.jsonl}"
# Pin the Compose project name so a run from the container's /repo cwd targets
# the SAME project (network/volume/container) as a manual run from the host.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zaehlwerk}"
# Use BuildKit so the Dockerfile's cache mounts (pnpm store + Next build cache)
# work — that's what turns a cold rebuild into an incremental one. COMPOSE_BAKE
# is disabled so compose builds via BuildKit directly instead of trying (and
# warning about) the missing buildx `bake` plugin.
export DOCKER_BUILDKIT=1
export COMPOSE_BAKE=false
DB_VOLUME="${COMPOSE_PROJECT_NAME}_zaehlwerk-db"
MIGRATE_DB_URL="${MIGRATE_DB_URL:-file:/data/zaehlwerk.db}"
IMAGE_TAG="${IMAGE_TAG:-zaehlwerk-main-portal:latest}"

# Redirect ALL output to a persistent log the UI tails live (GET /api/update/log)
# and truncate it for this run. The deployer APPENDS to it later, so the whole
# story stays in one place. Fall back to inherited stdio if not writable.
if : >"$LOG_FILE" 2>/dev/null; then
  exec >>"$LOG_FILE" 2>&1
fi

# Two clocks, one instant, two audiences.
#   now()     — UTC, ISO 8601 with Z. Goes into the status JSON, where the client
#               parses it and formats it locally. Must stay unambiguous.
#   log_now() — local time with its zone name, for the lines a human reads in the
#               live log. A German operator reading UTC timestamps reasonably
#               concludes the server's clock is wrong when it is not.
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log_now() { date +'%Y-%m-%d %H:%M:%S %Z'; }

# When this run began. Stamped into EVERY status line, not just the first, so
# elapsed time survives what happens next: the container is recreated mid-update
# and the server's memory goes with it. The status file on /data is the only
# state that persists, so anything the UI must still know afterwards has to live
# in it — the same lesson as the old updater that hung on "building".
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Machine-readable progress for GET /api/update/status → the UI.
# Args: <stage> <ok:true|false> <done:true|false> <message> [error] [targetSha]
#
# `mode` travels with every write because a rollback does NOT do the same four
# things an update does: it deliberately skips the migration. Without it the
# stepper ticked off "Datenbank migriert" for a step that never ran, which is
# worse than a vague display — it is wrong about the one step whose behaviour
# matters most here.
write_status() {
  printf '{"stage":"%s","ok":%s,"done":%s,"message":"%s","error":"%s","targetSha":"%s","mode":"%s","startedAt":"%s","updatedAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "$UPDATE_MODE" "$STARTED_AT" "$(now)" >"$STATUS_FILE" 2>/dev/null || true
}

# Den Arbeitsbaum auf den Stand zurueckstellen, der beim Start lief.
#
# Schritt 1 checkt den neuen Stand aus, Schritt 4 tauscht erst viel spaeter die
# Container. Wer dazwischen abbricht — oder wessen Build scheitert — hinterlaesst
# sonst einen Arbeitsbaum auf der NEUEN Version, waehrend die ALTE weiterlaeuft.
#
# Das ist nicht bloss unordentlich: Fehlt `APP_GIT_SHA` im Image, faellt die
# Versionsanzeige auf genau diesen Arbeitsbaum zurueck (app/lib/version.ts). Die
# App meldet dann die neue Version, obwohl die alte laeuft — und die
# Versionshistorie, die aus der Deploy-Historie liest, widerspricht ihr. Genau
# so gemeldet worden, nachdem ein Update im Build abgebrochen wurde.
restore_checkout() {
  # Nach der Uebergabe an den Deployer nicht mehr anfassen — siehe dort.
  [ -z "${SWAP_HANDED_OFF:-}" ] || return 0
  [ -n "${PREV_HEAD:-}" ] || return 0
  # Nur wenn sich wirklich etwas verschoben hat; sonst rauscht jeder Abbruch
  # vor dem Checkout unnoetig ins Protokoll.
  CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo "")"
  [ "$CURRENT_HEAD" = "$PREV_HEAD" ] && return 0
  echo "[update] Arbeitsbaum zurueck auf $PREV_HEAD"
  git checkout --detach --force "$PREV_HEAD" >/dev/null 2>&1 \
    || echo "[update] WARNUNG: Zuruecksetzen auf $PREV_HEAD fehlgeschlagen" >&2
}

fail() {
  restore_checkout
  write_status failed false true "$1" "${2:-}" "${GIT_SHA:-}"
  echo "[update] FAILED: $1 $(log_now)"
  exit 1
}

# Stopped from the UI (POST /api/update/cancel signals this process GROUP, so
# the running `docker compose build` dies with us). Record it as cancelled, not
# failed: nothing went wrong and the old build is still serving. The endpoint
# writes the same status again afterwards, because a killed shell may not get to
# run this at all — belt and braces on the one file the UI believes.
on_cancel() {
  # Zuerst zuruecksetzen, dann melden — die Meldung sagt "die laufende Version
  # wurde nicht veraendert", und das soll auch fuer den Arbeitsbaum stimmen.
  restore_checkout
  write_status cancelled false true "Update abgebrochen. Die laufende Version wurde nicht verändert." "" "${GIT_SHA:-}"
  echo "[update] CANCELLED $(log_now)"
  exit 143
}
trap on_cancel TERM INT

if [ "$UPDATE_MODE" = "rollback" ]; then
  VERB="Rollback"
else
  VERB="Update"
fi

echo "===== $UPDATE_MODE $(log_now) ====="
echo "[update] mode=$UPDATE_MODE ref=${UPDATE_REF:-<branch>} channel=$UPDATE_CHANNEL"
write_status started true false "$VERB gestartet"

cd "$REPO_ROOT" || fail "Arbeitsverzeichnis nicht gefunden"

# A rollback without a ref would fall into branch mode below and deploy the
# NEWEST code — the exact opposite of what was asked for. Refuse instead.
if [ "$UPDATE_MODE" = "rollback" ] && [ -z "$UPDATE_REF" ]; then
  fail "Rollback ohne Zielversion angefordert – abgebrochen"
fi

# 1) Pull -------------------------------------------------------------------
# Ausgangsstand merken, BEVOR irgendetwas ausgecheckt wird — restore_checkout()
# braucht ihn, und ab hier kann jeder Fehlschlag den Arbeitsbaum verschieben.
PREV_HEAD="$(git rev-parse HEAD 2>/dev/null || echo "")"
echo "[update] Ausgangsstand: ${PREV_HEAD:-unbekannt}"

write_status pulling true false "Neuer Code wird geholt"
if [ -n "$UPDATE_REF" ]; then
  # A released tag. Detached HEAD is correct here: the image is built from the
  # checkout and nothing ever commits in /repo, so there is no branch to be on.
  # --force on the fetch lets a moved tag (a re-cut release) still land.
  echo "[update] git fetch --tags + checkout $UPDATE_REF"
  git fetch --tags --force origin || fail "git fetch fehlgeschlagen – Details im Log"
  git checkout --detach "$UPDATE_REF" || fail "checkout $UPDATE_REF fehlgeschlagen – Details im Log"
else
  # Branch mode. `git checkout` first because a previous run on a pinned ref left
  # HEAD detached, and `git pull` refuses to run there. Deliberately NOT --force:
  # local modifications should still stop the deploy rather than be discarded.
  echo "[update] git checkout $UPDATE_BRANCH + pull --ff-only"
  git checkout "$UPDATE_BRANCH" || fail "checkout $UPDATE_BRANCH fehlgeschlagen – Details im Log"
  git pull --ff-only origin "$UPDATE_BRANCH" || fail "git pull fehlgeschlagen – Details im Log"
fi

GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA
echo "[update] target GIT_SHA=$GIT_SHA"

# Keep the disk tidy. Normally we KEEP ~6GB of BuildKit cache so rebuilds stay
# incremental (pnpm store + Next/Turbo caches). But that "keep" only ever runs
# HERE — manual `docker compose build` runs (debugging on the host) bypass this
# script and pile up a fresh ~1.5GB cache layer per build. That's how the cache
# ballooned past 20GB and filled the LXC disk, killing the build with ENOSPC at
# `COPY node_modules`. So: measure free space first, and if it's already tight,
# drop the "keep" and prune ALL build cache. A cold rebuild costs a few minutes;
# a full disk costs the whole deploy. Named volumes (the DB) are never touched.
#
# /repo is bind-mounted from the host, so `df` on it reflects the same
# filesystem that backs /var/lib/docker — i.e. the real space the build needs.
# Override the threshold with MIN_FREE_KB (default 8 GiB).
echo "[update] disk before prune:"
df -h "$REPO_ROOT" 2>/dev/null || true
docker container prune -f || true
docker image prune -f || true

# `docker builder prune` is a buildx subcommand. On a host where the buildx
# component is missing or broken it fails outright ("BuildKit is enabled but the
# buildx component is missing"), and because every call here is best-effort the
# error used to be swallowed — the low-disk branch reclaimed nothing, the build
# started anyway with ~3GB free and died unpacking the image layer. So: fall back
# to `docker system prune`, which goes through the daemon and needs no buildx.
# `--volumes` is deliberately NOT passed — that would delete the database.
# $1 = "all" (disk is tight — reclaim everything) or "some" (keep ~6GB of cache).
# The system-prune fallback only runs in the "all" case: it also drops unused
# images, i.e. the previous version's image we would roll back to. That is a fair
# trade when the alternative is a failed deploy, but not worth it on a host that
# has plenty of space and merely lacks buildx.
prune_build_cache() {
  if [ "$1" = "all" ]; then
    docker builder prune -af && return 0
    echo "[update] builder prune unavailable (no buildx?) — falling back to system prune"
    docker system prune -af || true
  else
    docker builder prune -f --keep-storage=6GB && return 0
    docker builder prune -f && return 0
    echo "[update] builder prune unavailable (no buildx?) — skipping, disk has room"
  fi
}

MIN_FREE_KB="${MIN_FREE_KB:-8388608}"
free_kb="$(df -Pk "$REPO_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ] && [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
  echo "[update] low disk: ${free_kb}KB free < ${MIN_FREE_KB}KB — pruning ALL build cache"
  prune_build_cache all
else
  echo "[update] disk ok: ${free_kb:-?}KB free — keeping ~6GB build cache"
  prune_build_cache some
fi
echo "[update] disk after prune:"
df -h "$REPO_ROOT" 2>/dev/null || true

# Refuse to start a build that cannot finish. A build needs room for the image
# layers on top of everything else; below this hard floor the export step is
# going to hit ENOSPC after burning several minutes, and an abort HERE leaves the
# old app serving instead. Override with ABORT_FREE_KB (default 4 GiB).
ABORT_FREE_KB="${ABORT_FREE_KB:-4194304}"
free_kb="$(df -Pk "$REPO_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ] && [ "$free_kb" -lt "$ABORT_FREE_KB" ]; then
  fail "Zu wenig Speicher: nur $((free_kb / 1024))MB frei, mindestens $((ABORT_FREE_KB / 1024))MB nötig. Alte Images/Build-Cache aufräumen oder die Disk vergrößern." "$GIT_SHA"
fi

# 2) Build the NEW image ----------------------------------------------------
# The old container keeps serving during this; buildkit steps stream to the
# live log. This is the long phase. Go through `docker compose` (not `docker
# build`) so it uses BuildKit — the Dockerfile's cache mounts require it, and
# `docker build` in this container has no buildx plugin (would fall back to the
# legacy builder and fail on `--mount`).
echo "[update] building new image"
write_status building true false "Neue Version wird gebaut" "" "$GIT_SHA"
GIT_SHA="$GIT_SHA" docker compose -f "$COMPOSE_FILE" build main-portal \
  || fail "Build fehlgeschlagen – Details im Log" "$GIT_SHA"

# 3) Migrate the database (additive) ----------------------------------------
# Run `prisma migrate deploy` via the one-shot `db-migrate` compose service
# (builder stage + DB volume). Using `docker compose run` keeps the build on
# BuildKit too — a plain `docker build --target=builder` here uses the legacy
# builder and chokes on the cache mounts. The builder layers are already cached
# from step 2, so this build is a fast cache hit. The migration is a PRECONDITION
# for the swap: if it fails we stop with the old app still running — no broken
# deploy.
#
# Bis v3 lief hier `prisma db push`. Das gleicht die Datenbank dem Schema an,
# ohne Historie und ohne zu benennen, was dabei verschwindet — auf fremden
# Instanzen mit Jahren an Daten die falsche Zusicherung. `db:deploy` sichert
# zuerst die Datei, stempelt eine bestehende Installation einmalig auf die
# Baseline und spielt danach nur die fehlenden Schritte ein.
#
# A ROLLBACK SKIPS THIS, deliberately. Eine Migration ist vorwaertsgerichtet:
# Das Schema der neueren Version bleibt stehen, wenn man auf eine aeltere
# Anwendung zurueckgeht. Rueckwaerts zu migrieren hiesse, genau die Spalten zu
# entfernen, in die die neuere Version bereits geschrieben hat — das gehoert
# nicht hinter einen "Zurueck"-Knopf.
#
# Leaving the newer schema in place is the safe asymmetry: Prisma selects named
# columns, so the older client simply never asks for the ones it does not know.
# What it CANNOT survive is a column the newer version added as NOT NULL without
# a default — inserts from the old client would then fail. Additive migrations
# on a table with rows need a default anyway, so this is rare rather than
# impossible; the UI says so before the button is pressed, and the answer is to
# restore a backup rather than to migrate backwards.
if [ "$UPDATE_MODE" = "rollback" ]; then
  echo "[update] rollback: skipping migrations (forward-only; older schema would drop columns)"
  write_status migrating true false "Datenbank bleibt unverändert (Rollback)" "" "$GIT_SHA"
else
  echo "[update] migrating database (prisma migrate deploy via compose)"
  write_status migrating true false "Datenbank wird migriert" "" "$GIT_SHA"
  GIT_SHA="$GIT_SHA" docker compose -f "$COMPOSE_FILE" run --rm --build db-migrate \
    || fail "DB-Migration fehlgeschlagen – Details im Log" "$GIT_SHA"
fi

# 4) Hand the swap to a detached deployer ------------------------------------
# Built from the NEW image (it has docker + compose). It is NOT part of the
# compose project, so recreating main-portal does not kill it — it finishes the
# swap and writes the authoritative done/failed status the UI waits for.
#
# docker-outside-of-docker gotcha: bind-mount SOURCE paths in a `docker run`
# (and in the compose file's `.:/repo`) are resolved by the HOST daemon, not
# inside this container. So we must give the deployer the repo at its real HOST
# path and run compose from there — otherwise `.` would resolve to a
# nonexistent host "/repo" and main-portal would come back with an empty repo.
SELF_CONTAINER="${SELF_CONTAINER:-zaehlwerk-main-portal}"
HOST_REPO="$(docker inspect "$SELF_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/repo"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
HOST_REPO="${HOST_REPO:-$REPO_ROOT}"
echo "[update] host repo path: $HOST_REPO"

echo "[update] handing container swap to detached deployer"
write_status restarting true false "Anwendung wird neu gestartet" "" "$GIT_SHA"
docker rm -f zaehlwerk-deployer >/dev/null 2>&1 || true
docker run -d --rm --name zaehlwerk-deployer \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${HOST_REPO}:${HOST_REPO}" \
  -v "${DB_VOLUME}:/data" \
  -w "$HOST_REPO" \
  --entrypoint sh \
  -e COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  -e COMPOSE_FILE="$COMPOSE_FILE" \
  -e UPDATE_STATUS_FILE="$STATUS_FILE" \
  -e UPDATE_LOG_FILE="$LOG_FILE" \
  -e GIT_SHA="$GIT_SHA" \
  -e UPDATE_MODE="$UPDATE_MODE" \
  -e UPDATE_STARTED_AT="$STARTED_AT" \
  -e UPDATE_REF="$UPDATE_REF" \
  -e UPDATE_LABEL="$UPDATE_LABEL" \
  -e UPDATE_CHANNEL="$UPDATE_CHANNEL" \
  -e DEPLOY_HISTORY_FILE="$DEPLOY_HISTORY_FILE" \
  "$IMAGE_TAG" \
  "${HOST_REPO}/scripts/deploy-swap.sh" \
  || fail "Deployer konnte nicht gestartet werden – Details im Log" "$GIT_SHA"

# Ab hier gehoert der Arbeitsbaum dem Deployer: Er faehrt Compose aus genau
# diesem Verzeichnis hoch. Ein Zuruecksetzen wuerde ihm den Boden entziehen —
# und noetig ist es auch nicht mehr, denn der Tausch auf die neue Version laeuft
# bereits. Das Signal-Fenster bis zum `exit` ist winzig, aber nicht null.
SWAP_HANDED_OFF=1

echo "[update] deployer launched; this script exits, swap continues detached $(log_now)"
exit 0
