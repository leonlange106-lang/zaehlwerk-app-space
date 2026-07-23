#!/bin/sh
# Pulls the latest commit and rebuilds/restarts the production containers.
#
# Invoked by apps/main-portal's POST /api/update/trigger (token-protected),
# or run manually on the host: `scripts/update.sh`.
#
# Expects to run somewhere that can reach both the git checkout and the
# Docker daemon that should be restarted — see DEPLOYMENT.md. Uses `sh`
# (not bash) so it also runs unmodified inside the slim node:alpine image.
set -eu

REPO_ROOT="${REPO_ROOT:-/repo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"

# Redirect ALL output to a persistent log file. The trigger endpoint starts
# this script detached with stdio discarded, so without this a failed update
# (full disk, auth error, failed rebuild) vanishes silently — exactly the
# "update did nothing" symptom. Truncated each run: the latest attempt is what
# matters for diagnosis. If the log path isn't writable, fall back to inherited
# stdio rather than aborting.
if : >"$LOG_FILE" 2>/dev/null; then
  exec >>"$LOG_FILE" 2>&1
fi

echo "===== update $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
cd "$REPO_ROOT"

echo "[update] git pull --ff-only origin $UPDATE_BRANCH"
git pull --ff-only origin "$UPDATE_BRANCH"

# Bake the freshly-pulled commit into the rebuilt image (Dockerfile ARG
# GIT_SHA) so the version badge / update check reflect the ACTUALLY running
# build. If the rebuild below fails, the old container keeps its old SHA and
# the check honestly keeps showing "update available".
GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA
echo "[update] rebuilding at GIT_SHA=$GIT_SHA"

echo "[update] docker compose -f $COMPOSE_FILE up -d --build"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[update] done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
