#!/bin/sh
# Pulls the latest commit and rebuilds/restarts the production containers.
#
# Invoked by apps/main-portal's POST /api/update/trigger (token-protected),
# or run manually on the host: `scripts/update.sh`.
#
# Expects to run somewhere that can reach both the git checkout and the
# Docker daemon that should be restarted — see DEPLOYMENT.md. Uses `sh`
# (not bash) so it also runs unmodified inside the slim node:alpine image.

REPO_ROOT="${REPO_ROOT:-/repo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"
STATUS_FILE="${UPDATE_STATUS_FILE:-/data/update-status.json}"
# Pin the Compose project name so an update run from the container's /repo cwd
# targets the SAME project (network/volume/container) as a manual run from the
# host — otherwise it forks a new "repo" project and collides. Matches the
# top-level `name:` in docker-compose.prod.yml; both say "zaehlwerk".
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zaehlwerk}"

# Redirect ALL output to a persistent log file. The trigger endpoint starts
# this script detached with stdio discarded, so without this a failed update
# (full disk, auth error, failed rebuild) vanishes silently. Truncated each
# run; if the path isn't writable, fall back to inherited stdio.
if : >"$LOG_FILE" 2>/dev/null; then
  exec >>"$LOG_FILE" 2>&1
fi

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Machine-readable progress for GET /api/update/status → the UI stepper.
# Args: <stage> <ok:true|false> <done:true|false> <message> [error] [targetSha]
write_status() {
  printf '{"stage":"%s","ok":%s,"done":%s,"message":"%s","error":"%s","targetSha":"%s","updatedAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "$(now)" >"$STATUS_FILE" 2>/dev/null || true
}

echo "===== update $(now) ====="
write_status started true false "Update gestartet"

if ! cd "$REPO_ROOT"; then
  write_status failed false true "Arbeitsverzeichnis nicht gefunden"
  exit 1
fi

echo "[update] git pull --ff-only origin $UPDATE_BRANCH"
write_status pulling true false "Neuer Code wird geholt"
if ! git pull --ff-only origin "$UPDATE_BRANCH"; then
  write_status failed false true "git pull fehlgeschlagen – Details im Log"
  echo "[update] FAILED (git pull) $(now)"
  exit 1
fi

# Bake the freshly-pulled commit into the rebuilt image so the version badge /
# update check reflect the ACTUALLY running build (see version.ts).
GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA
echo "[update] rebuilding at GIT_SHA=$GIT_SHA"
write_status building true false "Neue Version wird gebaut" "" "$GIT_SHA"

# Free disk BEFORE building so accumulated images + build cache don't fill the
# disk and fail the rebuild with ENOSPC. On a small LXC even a single cold
# `next build` can exhaust the disk, so prune AGGRESSIVELY: `-a` drops ALL
# unused images (not just dangling ones — old build layers add up), and a full
# `builder prune` clears the ENTIRE build cache rather than keeping a working
# set. Rebuilds are a little slower without a warm cache, but reliability on a
# constrained disk beats speed. `container prune` clears exited containers.
# None of these touch NAMED volumes, so the database volume is always safe.
# Non-fatal (|| true) so an unsupported flag never aborts the update.
echo "[update] disk usage before prune:"
df -h "$REPO_ROOT" 2>/dev/null || true
echo "[update] pruning all unused images + build cache + exited containers"
docker container prune -f || true
docker image prune -af || docker image prune -f || true
docker builder prune -af || docker builder prune -f || true
echo "[update] disk usage after prune:"
df -h "$REPO_ROOT" 2>/dev/null || true

# Migrate the DB schema BEFORE the new app starts. The self-update rebuilds
# the app, but the database lives on a persistent volume — a build that adds a
# table/column/index would otherwise start against an out-of-date DB and crash
# (exactly what a new `tarife` table once did). `prisma db push` is additive:
# it creates what's missing and refuses destructive changes, so it's safe to
# run unattended. The builder image carries the Prisma CLI + schema; the volume
# and DB path mirror docker-compose.prod.yml.
echo "[update] migrating database schema (prisma db push)"
MIGRATE_DB_URL="${MIGRATE_DB_URL:-file:/data/zaehlwerk.db}"
DB_VOLUME="${COMPOSE_PROJECT_NAME}_zaehlwerk-db"
if docker build --target=builder -t zaehlwerk-builder "$REPO_ROOT" &&
  docker run --rm -v "${DB_VOLUME}:/data" -e DATABASE_URL="$MIGRATE_DB_URL" \
    zaehlwerk-builder sh -c "cd packages/database && pnpm db:push"; then
  echo "[update] database schema in sync"
else
  write_status failed false true "DB-Migration fehlgeschlagen – Details im Log" "" "$GIT_SHA"
  echo "[update] FAILED (db push) $(now)"
  exit 1
fi

echo "[update] docker compose -f $COMPOSE_FILE up -d --build"
# On SUCCESS this command recreates (and thus tears down) THIS very container
# mid-run, so the lines below usually never execute — the UI detects success
# by the server returning on the new version, not by a "done" status. On BUILD
# failure the command returns non-zero WITHOUT a restart, so we can record it.
if docker compose -f "$COMPOSE_FILE" up -d --build; then
  write_status done true true "Update abgeschlossen" "" "$GIT_SHA"
  echo "[update] done $(now)"
else
  write_status failed false true "Build/Neustart fehlgeschlagen – Details im Log" "" "$GIT_SHA"
  echo "[update] FAILED (build) $(now)"
  exit 1
fi
