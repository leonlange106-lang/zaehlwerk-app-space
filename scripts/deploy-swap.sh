#!/bin/sh
# The final container swap of a self-update, run in a DETACHED helper container
# started by scripts/update.sh. Because this container is NOT part of the
# compose project, recreating main-portal doesn't kill it — so it can finish the
# recreate and write the authoritative done/failed status the UI waits for.
#
# Everything long (build) and risky (migration) already happened in update.sh
# with the old app still serving. By the time we get here the new image is built
# and the database is migrated, so all that's left is a quick recreate.
set -u

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOG_FILE="${UPDATE_LOG_FILE:-/data/update.log}"
STATUS_FILE="${UPDATE_STATUS_FILE:-/data/update-status.json}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zaehlwerk}"

# Append (never truncate) so the live log keeps the whole story across the swap.
exec >>"$LOG_FILE" 2>&1

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
write_status() {
  printf '{"stage":"%s","ok":%s,"done":%s,"message":"%s","error":"%s","targetSha":"%s","updatedAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "$(now)" >"$STATUS_FILE" 2>/dev/null || true
}

echo "[deploy] $(now) recreating main-portal (compose up -d --no-build)"
cd /repo || {
  write_status failed false true "Deployer: /repo nicht gefunden" "" "${GIT_SHA:-}"
  exit 1
}

# --no-build: the image was already built in update.sh; this is just the swap.
if docker compose -f "$COMPOSE_FILE" up -d --no-build; then
  echo "[deploy] swap complete $(now)"
  write_status done true true "Update abgeschlossen" "" "${GIT_SHA:-}"
else
  echo "[deploy] swap FAILED $(now)"
  write_status failed false true "Neustart fehlgeschlagen – Details im Log" "" "${GIT_SHA:-}"
fi
