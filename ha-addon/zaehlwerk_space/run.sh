#!/usr/bin/env sh
# Start-up: read the configured backend URL from the add-on options, template it
# into the Nginx config, then hand off to Nginx as PID 1.
set -eu

OPTIONS_FILE="/data/options.json"

# Home Assistant writes the user's add-on options to /data/options.json. Fall
# back to a sensible default if the file is missing (e.g. local `docker run`).
if [ -f "${OPTIONS_FILE}" ]; then
  BACKEND_URL="$(jq -r '.backend_url // empty' "${OPTIONS_FILE}")"
else
  BACKEND_URL=""
fi

if [ -z "${BACKEND_URL}" ]; then
  echo "[zaehlwerk_space] ERROR: 'backend_url' is not configured." >&2
  echo "[zaehlwerk_space] Set it in the add-on Configuration tab (e.g. http://192.168.1.50:3000)." >&2
  exit 1
fi

# Strip a trailing slash so proxy_pass builds clean upstream URLs.
BACKEND_URL="${BACKEND_URL%/}"
export BUILD_OPTIONS_BACKEND_URL="${BACKEND_URL}"

echo "[zaehlwerk_space] Proxying Home Assistant Ingress → ${BUILD_OPTIONS_BACKEND_URL}"

# Substitute ONLY our variable so Nginx's own $-variables ($host, $scheme, …)
# survive untouched.
envsubst '${BUILD_OPTIONS_BACKEND_URL}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

# Validate the generated config early for a clear failure message.
nginx -t

exec nginx -g 'daemon off;'
