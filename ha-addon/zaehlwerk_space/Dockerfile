# Lightweight Alpine/Nginx image for the Ingress reverse proxy.
#
# Home Assistant builds this locally for the target architecture; nginx:alpine
# is multi-arch (amd64 + aarch64), so a plain `FROM` is enough here.
FROM nginx:alpine

# gettext → provides `envsubst` (templating the backend URL into nginx.conf).
# jq      → reads the add-on options from /data/options.json at start-up.
RUN apk add --no-cache gettext jq

# The Nginx config template (backend URL is substituted at runtime) and the
# start-up script that performs the substitution and launches Nginx.
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 80

# `init: false` in config.yaml means this CMD runs as PID 1.
CMD ["/run.sh"]
