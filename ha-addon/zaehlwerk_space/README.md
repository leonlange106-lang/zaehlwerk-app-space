# Zählwerk App Space — HA Add-on

Thin `nginx:alpine` reverse-proxy add-on that surfaces the Zählwerk App Space
(Next.js, running in a separate LXC/Docker) as a native Home Assistant panel. It
relaxes the app's iframe-framing policy so HA can embed it **without rebuilding
the app**.

## Quick start (recommended: `panel_iframe` via exposed port)

1. Install (custom repo or copy to `/addons/zaehlwerk_space/`).
2. Configure: `backend_url` (e.g. `http://192.168.1.50:3000`) and `frame_parent`
   (your HA origin, e.g. `http://192.168.1.43:8123`); keep the `80/tcp → 8099`
   port mapping. **Start**.
3. Add a `panel_iframe` in HA `configuration.yaml` pointing at
   `http://<HA-IP>:8099`, then restart HA.

Full setup, the mixed-content (HTTP/HTTPS) note, and why plain Ingress 404s for
this app are in [`DOCS.md`](./DOCS.md).

## Files

| File                  | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------ |
| `config.yaml`         | Add-on manifest (port, `backend_url` + `frame_parent` options).     |
| `Dockerfile`          | `nginx:alpine` + `gettext` (envsubst) + `jq`.                       |
| `run.sh`              | Reads options, templates the Nginx config, starts Nginx.           |
| `nginx.conf.template` | Reverse proxy: WebSocket, forwarded headers, framing relaxation.   |
