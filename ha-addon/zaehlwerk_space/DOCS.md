# Zählwerk App Space — Home Assistant Add-on

This add-on makes the **Zählwerk App Space** (a Next.js dashboard running in a
separate Proxmox **LXC**/Docker container) available as a native panel in Home
Assistant. It is a tiny `nginx:alpine` reverse proxy — it does **not** run the
app, it forwards to the app's real URL on your LAN and relaxes the app's strict
iframe-framing policy so HA can embed it (no app rebuild required).

```
HA panel_iframe ─→ add-on nginx (host port 8099) ─→ LXC/Docker Next.js :3000
```

## Recommended setup: exposed port + `panel_iframe`

This is the route that **fully works** for this Next.js app. (Ingress is also
available but 404s for this app — see the note at the bottom.)

### 1. Install the add-on

- **Custom repo:** Settings → Add-ons → Add-on Store → ⋮ → **Repositories** →
  add `https://github.com/leonlange106-lang/zaehlwerk-ha-addon` → install
  **Zählwerk App Space**.
- **Or local:** copy `zaehlwerk_space/` into `/addons/` on the HAOS host.

### 2. Configure it

| Option         | Description                                                         | Example                     |
| -------------- | ----------------------------------------------------------------- | --------------------------- |
| `backend_url`  | Base URL of the app in the LXC, reachable from the HA host.        | `http://192.168.1.50:3000`  |
| `frame_parent` | Origin of **your** Home Assistant frontend (so it may frame the app). | `http://192.168.1.43:8123`  |

In the add-on's **Network** section, keep the host port mapping for `80/tcp`
(default **8099**).

Then **Start** the add-on. Quick check — from an HA terminal:
`curl -I http://localhost:8099` should return `HTTP/1.1 200` (or a redirect to
`/login`), not a connection error.

### 3. Add the panel to Home Assistant

Edit `configuration.yaml` (via the *File editor* or *Studio Code Server* add-on),
pointing at the **add-on's port on the HA host** (not the LXC):

```yaml
panel_iframe:
  zaehlwerk:
    title: "Zählwerk"
    icon: mdi:gauge
    url: "http://192.168.1.43:8099"   # <HA-IP>:<add-on port>
    require_admin: false
```

Then **Settings → System → Restart**. A **Zählwerk** entry appears in the
sidebar and loads the full app — no 404, no missing styles, because the proxy
serves it at its own root (no dynamic Ingress sub-path).

> **HTTP vs HTTPS (mixed content):** if you open Home Assistant over `https://`,
> the browser blocks an `http://` iframe. Either reach HA over `http://` on the
> LAN, or put the app behind an HTTPS reverse proxy and use that URL. Match the
> scheme/host/port in `frame_parent` to how you actually open HA.

## What the add-on does

- **Reverse proxy** to `backend_url` (WebSocket `Upgrade`/`Connection` proxied,
  so live features work).
- **Relaxes framing without an app rebuild:** drops the app's
  `X-Frame-Options: DENY` and re-emits its CSP with
  `frame-ancestors 'self' <frame_parent>`, so Home Assistant may embed it.
- **Forwarded headers:** `Host`, `X-Real-IP`, `X-Forwarded-For`,
  `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-HA-Ingress` (the app runs with
  `trustHost: true` and trims duplicate chrome when embedded).

## Why not Ingress?

Home Assistant Ingress serves each session under a dynamic path
(`/api/hassio_ingress/<token>/`). Next.js emits **root-absolute** URLs (`/_next/…`,
and the unauthenticated redirect to `/login`), which the browser resolves against
the HA origin **root** — dropping the Ingress prefix — so they hit HA itself and
return **`404: not found`**. A reverse proxy can't fix this: those requests never
reach the add-on. Ingress remains available via the add-on's **Open Web UI**
button for simple cases, but for this app use the `panel_iframe` route above.

If you'd rather not run this proxy at all, you can instead rebuild the app image
with the HA origin allowed and point `panel_iframe` straight at the LXC
(`http://<LXC-IP>:3000`):

```bash
# inside the app's build (Dockerfile build-arg / compose), not the host shell:
FRAME_ANCESTORS="'self' http://192.168.1.43:8123"
```

The add-on route is simpler because it needs **no** change to the app or its
Docker image.
