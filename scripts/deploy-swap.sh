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
HISTORY_FILE="${DEPLOY_HISTORY_FILE:-/data/deploy-history.jsonl}"
UPDATE_MODE="${UPDATE_MODE:-update}"
UPDATE_REF="${UPDATE_REF:-}"
UPDATE_LABEL="${UPDATE_LABEL:-}"
UPDATE_CHANNEL="${UPDATE_CHANNEL:-stable}"
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

echo "[deploy] $(log_now) recreating main-portal (compose up -d --no-build)"
# Run from the repo root (this script lives in <repo>/scripts). The caller mounts
# the repo at its real HOST path and sets that as the workdir, so compose's
# `.:/repo` bind resolves correctly on the host daemon.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR" || {
  write_status failed false true "Deployer: Repo-Verzeichnis nicht gefunden" "" "${GIT_SHA:-}"
  exit 1
}
echo "[deploy] repo dir: $REPO_DIR"

# --no-build: the image was already built in update.sh; this is just the swap.
if docker compose -f "$COMPOSE_FILE" up -d --no-build; then
  echo "[deploy] swap complete $(log_now)"
  record_deploy
  if [ "$UPDATE_MODE" = "rollback" ]; then
    write_status done true true "Rollback abgeschlossen" "" "${GIT_SHA:-}"
  else
    write_status done true true "Update abgeschlossen" "" "${GIT_SHA:-}"
  fi
else
  echo "[deploy] swap FAILED $(log_now)"
  write_status failed false true "Neustart fehlgeschlagen – Details im Log" "" "${GIT_SHA:-}"
fi
