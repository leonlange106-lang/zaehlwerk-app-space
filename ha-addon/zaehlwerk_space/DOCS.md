# Zählwerk App Space — Home Assistant Ingress Add-on

This add-on surfaces the **Zählwerk App Space** (a Next.js dashboard running in a
separate Proxmox **LXC** container) as a native panel inside Home Assistant,
using **Ingress**. The add-on itself is a tiny `nginx:alpine` reverse proxy — it
does not run the app, it forwards Home Assistant's Ingress traffic to the app's
real URL on your LAN.

```
HA frontend ─(Ingress)→ add-on (nginx :80) ─(reverse proxy)→ LXC Next.js :3000
```

## Installation

1. Copy the folder `zaehlwerk_space/` into `/addons/` on the Home Assistant OS
   host, so it lives at `/addons/zaehlwerk_space/`.
   (Settings → Add-ons → Add-on Store → ⋮ → *Repositories* is **not** needed for
   a local add-on; local add-ons under `/addons` are picked up automatically.)
2. Settings → Add-ons → **Add-on Store** → ⋮ → **Check for updates**, then open
   the **Local add-ons** section and select **Zählwerk App Space**.
3. **Install**.

## Configuration

| Option        | Description                                                        | Example                    |
| ------------- | ----------------------------------------------------------------- | -------------------------- |
| `backend_url` | Base URL of the Next.js app in the LXC (scheme + host + port).     | `http://192.168.1.50:3000` |

Set `backend_url` to the address where the app is reachable from the Home
Assistant host, then **Start** the add-on. A **Zählwerk** entry appears in the HA
sidebar (icon `mdi:gauge`).

> The `backend_url` must be reachable **from the Home Assistant host** — test with
> `curl` from an HA terminal if the panel stays blank.

## What the add-on does

- **Ingress**: HA serves the panel under its own origin and auth; no LAN port of
  the add-on is exposed.
- **WebSocket support**: `Upgrade`/`Connection` headers are proxied, so live
  features and Next.js HMR work.
- **Forwarded headers**: passes `Host`, `X-Real-IP`, `X-Forwarded-For`,
  `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-HA-Ingress` so the app (which
  runs with `trustHost: true`) builds correct URLs and can trim duplicate chrome
  when embedded.
- **`proxy_redirect off`**: redirect/`Location` headers are left untouched so
  Ingress path routing stays intact.

## Required app build flag

Because HA renders the panel in an **iframe**, the app must permit framing. The
app ships strict by default (`frame-ancestors 'none'` + `X-Frame-Options: DENY`).

**You do not need to rebuild the app for Ingress.** This add-on's Nginx strips
the upstream framing headers and re-emits the CSP with `frame-ancestors 'self'`,
so the panel renders out of the box — no `HA_INGRESS` build flag, nothing to
change in the LXC. (The optional `HA_INGRESS=true` / `FRAME_ANCESTORS=…` build
flags still exist if you prefer to relax it at the app instead — e.g. for the
`panel_iframe` fallback below, which does **not** pass through this add-on.)

The app also detects the embedded context automatically (it's framed, or via
`?embedded=true`) and hides its duplicate brand/title, since the HA panel already
provides one.

## Known limitation: Ingress sub-path & static assets

Home Assistant Ingress serves each session under a dynamic path
(`/api/hassio_ingress/<token>/`). Next.js emits **root-absolute** asset URLs
(`/_next/…`), which the browser resolves against the HA origin root — dropping
the Ingress prefix. On a strict setup this can cause `/_next/*` assets to 404
inside the frame.

This add-on forwards the `X-Ingress-Path` context via standard headers, but a
generic reverse proxy cannot reliably rewrite the absolute paths that Next's
client-side router builds at runtime. If you hit blank/asset-404 panels, the
robust options are:

1. **Direct panel (simplest, always works):** instead of Ingress, add a
   `panel_iframe` in Home Assistant `configuration.yaml` pointing straight at the
   LXC app:

   ```yaml
   panel_iframe:
     zaehlwerk:
       title: "Zählwerk"
       icon: mdi:gauge
       url: "http://192.168.1.50:3000"
       require_admin: false
   ```

   Because HA now frames the app **cross-origin** (HA host → LXC host), the
   add-on's Nginx is out of the loop, so the app itself must allow the HA origin.
   Build it once in the LXC naming your HA origin:

   ```bash
   FRAME_ANCESTORS="'self' http://homeassistant.local:8123" pnpm --filter main-portal build
   ```

   (Use your real HA URL/port; add both `http://…` and `https://…` variants if
   you reach HA either way.) You get a native sidebar panel and no Ingress
   sub-path issue; you lose HA's auth-gating in front of the app (the app has its
   own login).

2. **Reverse proxy at a stable path / subdomain** (e.g. via the HA *NGINX Proxy
   Manager* add-on or your router), then use `panel_iframe` against that URL.

Use whichever fits your network. Try Ingress first (nothing to build); if the
panel stays blank due to the asset sub-path issue, switch to the `panel_iframe`
fallback, which always works.
