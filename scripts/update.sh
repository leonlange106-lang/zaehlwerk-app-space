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
#   3. migrate   – additive `prisma db push` as a PRECONDITION: if it fails we
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
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"
STATUS_FILE="${UPDATE_STATUS_FILE:-/data/update-status.json}"
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

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Machine-readable progress for GET /api/update/status → the UI.
# Args: <stage> <ok:true|false> <done:true|false> <message> [error] [targetSha]
write_status() {
  printf '{"stage":"%s","ok":%s,"done":%s,"message":"%s","error":"%s","targetSha":"%s","updatedAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "$(now)" >"$STATUS_FILE" 2>/dev/null || true
}

fail() {
  write_status failed false true "$1" "${2:-}" "${GIT_SHA:-}"
  echo "[update] FAILED: $1 $(now)"
  exit 1
}

echo "===== update $(now) ====="
write_status started true false "Update gestartet"

cd "$REPO_ROOT" || fail "Arbeitsverzeichnis nicht gefunden"

# 1) Pull -------------------------------------------------------------------
echo "[update] git pull --ff-only origin $UPDATE_BRANCH"
write_status pulling true false "Neuer Code wird geholt"
git pull --ff-only origin "$UPDATE_BRANCH" || fail "git pull fehlgeschlagen – Details im Log"

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

MIN_FREE_KB="${MIN_FREE_KB:-8388608}"
free_kb="$(df -Pk "$REPO_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ] && [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
  echo "[update] low disk: ${free_kb}KB free < ${MIN_FREE_KB}KB — pruning ALL build cache"
  docker builder prune -af || true
else
  echo "[update] disk ok: ${free_kb:-?}KB free — keeping ~6GB build cache"
  docker builder prune -f --keep-storage=6GB || docker builder prune -f || true
fi
echo "[update] disk after prune:"
df -h "$REPO_ROOT" 2>/dev/null || true

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
# Run `prisma db push` via the one-shot `db-migrate` compose service (builder
# stage + DB volume). Using `docker compose run` keeps the build on BuildKit
# too — a plain `docker build --target=builder` here uses the legacy builder and
# chokes on the cache mounts. The builder layers are already cached from step 2,
# so this build is a fast cache hit. db push is additive and a PRECONDITION for
# the swap: if it fails we stop with the old app still running — no broken deploy.
echo "[update] migrating database (prisma db push via compose)"
write_status migrating true false "Datenbank wird migriert" "" "$GIT_SHA"
GIT_SHA="$GIT_SHA" docker compose -f "$COMPOSE_FILE" run --rm --build db-migrate \
  || fail "DB-Migration fehlgeschlagen – Details im Log" "$GIT_SHA"

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
  "$IMAGE_TAG" \
  "${HOST_REPO}/scripts/deploy-swap.sh" \
  || fail "Deployer konnte nicht gestartet werden – Details im Log" "$GIT_SHA"

echo "[update] deployer launched; this script exits, swap continues detached $(now)"
exit 0
