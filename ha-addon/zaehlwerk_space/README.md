# Zählwerk App Space — HA Ingress Add-on

Thin `nginx:alpine` reverse-proxy add-on that surfaces the Zählwerk App Space
(Next.js, running in a separate Proxmox LXC) as a native Home Assistant panel via
**Ingress**.

## Quick start

1. Copy this folder to `/addons/zaehlwerk_space/` on the HAOS host.
2. Install it from **Settings → Add-ons → Local add-ons**.
3. Set `backend_url` (e.g. `http://192.168.1.50:3000`) and **Start**.
4. Build the Next.js app with `HA_INGRESS=true` so it allows being iframed.

Full setup, options and the Ingress sub-path caveat are in [`DOCS.md`](./DOCS.md).

## Files

| File                  | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `config.yaml`         | Add-on manifest (Ingress, panel, `backend_url` option/schema). |
| `Dockerfile`          | `nginx:alpine` + `gettext` (envsubst) + `jq`.                  |
| `run.sh`              | Reads `backend_url`, templates the Nginx config, starts Nginx. |
| `nginx.conf.template` | Reverse proxy: WebSocket, forwarded headers, `proxy_redirect off`. |
