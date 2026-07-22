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

echo "[update] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting update in $REPO_ROOT (branch: $UPDATE_BRANCH)"

cd "$REPO_ROOT"

echo "[update] git pull --ff-only origin $UPDATE_BRANCH"
git pull --ff-only origin "$UPDATE_BRANCH"

echo "[update] docker compose -f $COMPOSE_FILE up -d --build"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[update] done."
