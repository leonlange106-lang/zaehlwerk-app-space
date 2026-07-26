# Deployment: Proxmox LXC + Docker

Step-by-step setup for running `apps/main-portal` in a Docker-based Proxmox
LXC container, including the self-update mechanism (`/einstellungen` →
System-Update).

> **Not yet verified against a real Proxmox host or an actual `docker
> build`** — this was written from the Dockerfile/compose file in this repo
> and standard Proxmox/Docker practice, but neither was tested end-to-end in
> the session that produced it. Test in a throwaway LXC before relying on it.

## Architecture

- One container (`zaehlwerk-main-portal`) runs the Next.js standalone server.
- SQLite database file lives on a named Docker volume (`zaehlwerk-db`),
  independent of the container lifecycle.
- The **live git checkout** on the LXC host is bind-mounted into the
  container at `/repo`. The self-update feature (`git pull` +
  `docker compose up -d --build`) runs against that bind mount, and the
  container talks to the **host's** Docker daemon via a mounted
  `docker.sock` (docker-outside-of-docker) to trigger the rebuild.

That last point is a real security tradeoff — see [Self-update security](#self-update-security-read-this) before exposing this beyond your own network.

## 1. Create the Proxmox LXC

1. Download a Debian 12 (or Ubuntu 22.04+) LXC template if you don't have one:
   `Datacenter → <node> → local (Templates) → Templates → download`.
2. Create the container:
   - **Unprivileged**: yes (Docker works fine unprivileged on modern kernels).
   - **Features** (`Options → Features`): enable **Nesting** — required for
     Docker inside an LXC. Enabling **keyctl** as well avoids some Docker
     warnings.
   - Resources: 2 vCPU / 2 GB RAM / 8 GB disk is comfortable for this app;
     adjust to taste.
3. Start the container and open a console (`pct enter <vmid>` from the
   Proxmox host, or the web console).

## 2. Install Docker inside the LXC

```sh
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
docker run --rm hello-world   # sanity check
```

If `hello-world` fails with a cgroup/overlay error, double-check that
**Nesting** is actually enabled on the LXC (Proxmox → container → Options →
Features) and reboot the container.

## 3. Generate a GitHub access token

This repo is **private**, and GitHub has not accepted plain account passwords
for git operations since 2021 — cloning with just a username/password (as
the `git clone` prompt below suggests) fails with `Invalid username or
token. Password authentication is not supported`. You need a token instead,
and — because `scripts/update.sh` later runs `git pull` **unattended**, with
no terminal to type a password into — that token needs to be wired up so git
never has to ask.

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate
   new token.
2. Repository access: **Only select repositories** → `zaehlwerk-app-space`.
3. Permissions: **Contents → Read-only** (that's all `git clone`/`pull` and
   the GitHub API check need).
4. Generate and copy the token (`github_pat_…`) — you'll use it twice: once
   for the clone below, once for `GITHUB_TOKEN` in step 5.

## 4. Clone the repository

```sh
mkdir -p /opt/zaehlwerk
git clone https://github.com/leonlange106-lang/zaehlwerk-app-space.git /opt/zaehlwerk
```

When prompted for a username, enter your GitHub username; when prompted for
a **password, paste the token from step 3** (not your actual GitHub
password — that's what the error message is telling you).

Then make the credential permanent, so the unattended `git pull` inside
`scripts/update.sh` doesn't hang waiting for a prompt that will never come:

```sh
cd /opt/zaehlwerk
git remote set-url origin "https://<token>@github.com/leonlange106-lang/zaehlwerk-app-space.git"
git pull   # should now run with no prompt at all
```

(`.git/config` now contains the token in plain text — that's consistent with
this whole setup already trusting root on the LXC; just don't `git remote -v`
that output into a bug report or screenshot.)

This checkout is what gets bind-mounted into the container and is what
`git pull` operates on during a self-update — keep it on the branch you want
running in production (typically `main`).

## 5. Configure environment variables

Create `/opt/zaehlwerk/.env` (read by `docker compose`, **not** committed):

```sh
cat > .env <<'EOF'
# Same fine-grained PAT from step 3 — needed here too because the repo is
# private and /api/update/check hits GitHub's API.
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxx

# Shared secret for POST /api/update/trigger. Technically optional, and worth
# setting anyway: this container mounts /var/run/docker.sock, so whatever can
# start a deploy is root-equivalent ON THE HOST. Login auth is the primary gate;
# this is the second one in front of the single most powerful endpoint.
# Generate with: openssl rand -hex 32
UPDATE_TRIGGER_TOKEN=REPLACE_ME

# REQUIRED for login/sessions (Auth.js). Must be a STABLE random value —
# changing it logs everyone out AND makes stored 2FA secrets unreadable
# (they are encrypted with a key derived from it). Generate with:
# openssl rand -base64 32
AUTH_SECRET=REPLACE_ME

# What Caddy answers to — a hostname that resolves on your LAN, or simply the
# LXC's IP address (Caddy issues internal certificates for IPs too). See § 7.
ZW_HOSTNAME=192.168.1.50
EOF
chmod 600 .env
```

## 6. Build and start

The Dockerfile uses BuildKit cache mounts (persistent pnpm store + Next build
cache) to keep rebuilds fast, so **BuildKit must be enabled** — export
`DOCKER_BUILDKIT=1` for any manual build. `scripts/update.sh` (the in-app
update) already sets it. If a build errors on `--mount`, BuildKit isn't active.

```sh
export DOCKER_BUILDKIT=1
GIT_SHA=$(git rev-parse HEAD) docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f main-portal
```

The `GIT_SHA=…` prefix bakes the built commit into the image so the
System-Update panel shows the version the app is **actually running**.
Plain `docker compose … up -d --build` also works, but then the version
badge reads "unknown". The self-update script (`scripts/update.sh`) sets
this automatically.

The app listens on port `3000`, but the database is still **empty** on the
first run — you'll see `PrismaClientKnownRequestError: The table
main.zaehler does not exist` in the logs and every page 500s until you
create the schema.

The slim runtime image deliberately has no `pnpm`/`prisma` CLI, so the schema
is created from the **builder** stage instead. The `db-migrate` compose service
(profile `tools`) builds that stage and runs `db:push` against the DB volume —
via Compose so the build uses BuildKit (a plain `docker build` here hits the
legacy builder and fails on the Dockerfile's cache mounts):

```sh
docker compose -f docker-compose.prod.yml run --rm --build db-migrate
```

`db:push` is safe and idempotent — it only creates/updates tables, never
touches existing rows. Reload the app and the pages should work (no
container restart needed; the tables simply exist now).

### Optional: load demo data

There's also a seed script that inserts example Strom/Gas/Wasser meters with
a few months of readings. **It is destructive** — `prisma/seed.ts` starts by
`deleteMany()`-ing every location, meter and reading, so only ever run it on
a fresh/empty database, **never** on one that already holds real data:

```sh
docker run --rm \
  -v zaehlwerk_zaehlwerk-db:/data \
  -e DATABASE_URL="file:/data/zaehlwerk.db" \
  zaehlwerk-builder \
  sh -c "cd packages/database && pnpm db:seed"
```

## 7. Put it behind TLS (do this — it is not optional in practice)

**Without TLS the session cookie travels the LAN in clear text.** Anyone on the
same network who reads it has the session. The same fact broke 2FA login for a
whole release: a `secure` cookie over HTTP is discarded by the browser with no
error at all, so the second factor had nothing to identify the user by. Behind
TLS `isSecureConnection()` recognises the connection by itself — nothing in the
app has to change.

### 7.1 The bundled setup (Caddy in the same compose)

`docker-compose.prod.yml` ships a `caddy` service and a `Caddyfile`. Two things
have to be in `.env`:

```env
# What the app answers to. Whatever you put here must be what you TYPE in the
# browser, or the certificate will not match. Three workable choices:
#
#   a) The LXC's IP address — ZW_HOSTNAME=192.168.1.50
#      Needs no DNS at all, and Caddy's internal CA issues for IPs happily.
#      The pragmatic choice on a home LAN. Requires a static lease, though:
#      if DHCP moves the LXC, both the URL and the certificate stop matching.
#
#   b) A name your router hands out. The suffix differs per vendor
#      (.fritz.box, .lan, .home, .local) — check what your own resolves as
#      before picking one; a name that does not resolve locks everyone out.
#
#   c) A name you add to each device's hosts file. Works everywhere, but has
#      to be repeated per device, so it suits a single-machine setup.
ZW_HOSTNAME=192.168.1.50

# Leave this UNSET for now. It is step 7.2.
# APP_BIND=127.0.0.1
```

Then:

```bash
cd /opt/zaehlwerk
# NOT just `git pull`. A channel deploy checks out a TAG (`git checkout
# --detach`), so the repo sits on a detached HEAD and `git pull` refuses with
# "You are not currently on a branch" — it fetches and then merges nothing. The
# failure is quiet in the worst way: the next `up -d` happily starts the OLD
# compose file, no new container appears, and nothing explains why.
git fetch origin
git checkout main
git pull

# Verify the new files actually arrived before starting anything.
ls Caddyfile && grep -q 'caddy:' docker-compose.prod.yml && echo OK

# Caddy needs 80 and 443. If something already holds them it will not start.
ss -tlnp | grep -E ':80 |:443 '     # expect: no output

docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps        # zaehlwerk-caddy must be up
```

Moving the checkout back to `main` does not disturb the running containers —
they serve from an image that is already built. The next in-app update checks
out its target ref regardless, so this costs nothing.

Port 3000 is still open at this point — deliberately. Verify HTTPS works
*before* closing it:

```bash
curl -kI https://zaehlwerk.fritz.box/api/health    # expect: HTTP/2 200
```

**Certificate trust.** The LAN name is not publicly resolvable, so Let's Encrypt
cannot validate it; Caddy issues from its own local CA instead. The encryption
on the wire is identical — the only difference is who trusts the certificate.
Install Caddy's root CA once per device to get rid of the warning:

```bash
docker cp zaehlwerk-caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Import that file as a trusted root (Windows: *Trusted Root Certification
Authorities*; Android: *Settings → Security → Encryption & credentials*; iOS:
install the profile, then enable it under *About → Certificate Trust Settings*).
Worth doing rather than clicking through the warning: without a trusted
certificate the browser refuses the PWA install ("Add to Home Screen").

The CA lives in the `caddy-data` volume. **Back it up** — if it is lost, Caddy
generates a new one and every device has to trust it again.

### 7.2 Take port 3000 out of the LAN

Only after 7.1 verifies. Add to `.env`:

```env
APP_BIND=127.0.0.1
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

Caddy still reaches the app — it goes through the compose network to
`main-portal:3000`, not through the published port. From another machine
`http://<lxc-ip>:3000` is now refused, and HTTPS is the only way in.

**Rollback is one line:** remove `APP_BIND` from `.env` and `up -d` again. That
is why the bind address is a variable instead of an edit to the compose file.

### 7.3 Cloudflare, afterwards

Reaching the instance from outside is a separate decision, and the ordering
matters: **harden first, expose second.** Without Cloudflare Access in front of
the *entire* origin, anyone who learns the hostname stands at your login form.

Checklist before switching the public hostname on:

1. **Cloudflare Access in front of the whole origin**, not just single paths.
2. **Service tokens** for `/api/v1/*` (ingestion) — an interactive Access login
   would break the Home Assistant push and any sync script. *The Docker
   healthcheck needs no exception: it runs inside the container against
   `localhost:3000` and never passes through Cloudflare.*
3. **WAF**: rate limit `/api/auth/*` and `/login`, bot-fight mode.
4. **`--no-autoupdate`**, `cloudflared` as a systemd service under its own user.
5. **Turn on instance-wide 2FA** (Settings → Security & access) so Access and the
   app are two independent barriers rather than one.

Then pick the shape:

- **`cloudflared` on this LXC** pointing at `http://main-portal:3000` over the
  compose network. Simplest, and the hop never leaves the machine. The commented
  block in `Caddyfile` stays commented.
- **`cloudflared` elsewhere** pointing at this Caddy. Then enable that block and
  install a Cloudflare **origin certificate** — `tls internal` is unknown to
  Cloudflare, so the connection would either fail or need `noTLSVerify: true`,
  which defeats the purpose.

### 7.4 Other proxies

If you would rather terminate TLS somewhere else entirely, the following still
apply. In that case do **not** set `APP_BIND=127.0.0.1` — bind to the LXC's LAN
address instead, or the external proxy cannot reach the app.

### Caddy (simplest — automatic HTTPS)

```
zaehlwerk.example.com {
  reverse_proxy <lxc-ip>:3000
}
```

Caddy fetches and renews a Let's Encrypt certificate on its own; nothing else to do.

### nginx (with Let's Encrypt via certbot)

```nginx
# /etc/nginx/sites-available/zaehlwerk.conf
server {
  listen 80;
  server_name zaehlwerk.example.com;

  location / {
    proxy_pass http://<lxc-ip>:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
  }
}
```

`X-Forwarded-Host`/`-Proto` matter: the in-app Smart-Home snippet generator
derives the portal URL from these headers, so without them the generated
`curl`/Home-Assistant snippets show the wrong origin. Then:

```sh
ln -s /etc/nginx/sites-available/zaehlwerk.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d zaehlwerk.example.com    # provisions + auto-renews TLS
```

### Traefik (Docker labels)

If you run Traefik as your edge, add these labels to the `main-portal` service
in `docker-compose.prod.yml` (assumes an `websecure` entrypoint on :443 and a
`letsencrypt` cert resolver already configured in Traefik):

```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.zaehlwerk.rule=Host(`zaehlwerk.example.com`)"
      - "traefik.http.routers.zaehlwerk.entrypoints=websecure"
      - "traefik.http.routers.zaehlwerk.tls.certresolver=letsencrypt"
      - "traefik.http.services.zaehlwerk.loadbalancer.server.port=3000"
```

Traefik reads the container port directly, so you don't even need to publish
port 3000 on the host — put the app and Traefik on the same Docker network.

### Cloudflare Tunnel (no open inbound ports)

Good when the LXC has no public IP or you don't want to open the firewall at
all. `cloudflared` dials **out** to Cloudflare; TLS terminates at Cloudflare's
edge.

```sh
# inside the LXC (or its own container)
cloudflared tunnel login
cloudflared tunnel create zaehlwerk
```

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-uuid>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: zaehlwerk.example.com
    service: http://localhost:3000
  - service: http_status:404
```

```sh
cloudflared tunnel route dns zaehlwerk zaehlwerk.example.com
cloudflared tunnel run zaehlwerk      # or install as a systemd service
```

Because the tunnel exposes the app publicly, still lock down
`/api/update/trigger` — restrict it with a Cloudflare Access policy (or keep
`UPDATE_TRIGGER_TOKEN` set) so self-update can't be triggered by strangers.

## Self-update security (read this)

`docker-compose.prod.yml` mounts `/var/run/docker.sock` into the app
container so the update-trigger endpoint can rebuild and restart containers
on the **host**. That is root-equivalent access to the host — anyone who can
reach `POST /api/update/trigger` with a valid `UPDATE_TRIGGER_TOKEN` can run
arbitrary containers on your LXC.

Mitigations already in place:
- The endpoint requires the `x-update-token` header to match
  `UPDATE_TRIGGER_TOKEN` (timing-safe comparison), and refuses to run at all
  if that env var isn't set.
- `scripts/update.sh` is a fixed script invoked with no user-controlled
  arguments — there's no command-injection surface in the trigger itself.

What you still need to do:
- **Never expose this service directly to the internet without a reverse
  proxy that restricts `/api/update/trigger` to your own IP/VPN**, or put the
  whole app behind a VPN (Tailscale/WireGuard) if it doesn't need to be
  public.
- Treat `UPDATE_TRIGGER_TOKEN` like a root password: generate it randomly,
  store it in a password manager, rotate it if it might have leaked.
- If you don't need remote self-update at all, simplest fix is to drop the
  `docker.sock` volume mount and `docker-cli`/`docker-cli-compose` packages
  from the Dockerfile, and just run `scripts/update.sh` manually over SSH
  instead.

## Backups

The SQLite database lives on the `zaehlwerk-db` named volume, mounted at
`/data/zaehlwerk.db` inside the container. To back it up:

```sh
docker run --rm -v zaehlwerk-db:/data -v "$PWD/backups":/backup \
  alpine cp /data/zaehlwerk.db "/backup/zaehlwerk-$(date +%Y%m%d).db"
```

Run that on a cron schedule and copy the backups off the LXC.

## Disk management

Every `docker compose … up -d --build` — including each self-update — adds
image layers and build cache. Over many rebuilds this **fills the disk**, and
a build then dies with `ENOSPC: no space left on device` (often surfacing as
a confusing `mkdir … ENOENT` during page prerendering). Reclaim space
without touching your data:

```sh
df -h /                 # how full is the disk?
docker system df        # what is Docker using?
docker system prune -af # remove unused images + stopped containers + build cache
docker builder prune -af

# NOTE: never add --volumes here — that would delete the zaehlwerk-db volume
# (your database). prune without it leaves named volumes untouched.
```

Then rebuild. If the disk stays under a few GB free even after pruning, grow
the LXC's disk from the Proxmox host: `pct resize <vmid> rootfs +8G`. This
stack (node_modules incl. react-pdf + build cache + the image) is comfortable
with ~12–16 GB.

## Troubleshooting

- **`git clone`/`git pull` fails with `Invalid username or token. Password
  authentication is not supported for Git operations.`**: you typed your
  actual GitHub account password at the prompt. Use a fine-grained PAT
  instead — see step 3. If this happens during an automated update (not an
  interactive clone), it means `git remote set-url` from step 4 was never
  run, or the token in it expired/was revoked; regenerate the token and
  rerun `git remote set-url origin "https://<token>@github.com/..."`.
- **`prisma generate` fails during build with a permissions/rename error**:
  usually a stale file lock from a previous failed build; `docker compose
  build --no-cache` clears it.
- **Every page 500s with `PrismaClientInitializationError: ... could not
  locate the Query Engine for runtime "linux-musl-openssl-3.0.x"`**: the
  Dockerfile sets `PRISMA_QUERY_ENGINE_LIBRARY` explicitly to work around
  this (Next's bundlers don't reliably preserve Prisma's own `__dirname`-based
  search for the binary — see the fix/prisma-* PRs on this repo for the full
  saga). If you still hit this, the binary's filename likely no longer
  matches what's hardcoded in the Dockerfile — check the real filename with
  `docker compose -f docker-compose.prod.yml exec main-portal ls
  /app/packages/database/generated/client` and update the `ENV
  PRISMA_QUERY_ENGINE_LIBRARY=...` line in the Dockerfile to match.
- **Every page (or a detail page) 500s with `PrismaClientKnownRequestError:
  The table main.<x> does not exist`** (code `P2021`): the DB schema is behind
  the running code. `scripts/update.sh` now runs `prisma db push`
  automatically on every self-update, so this only happens on a first-ever
  deploy (run the `db:push` step from section 6) or a **manual** `docker
  compose up` that skipped migration. Recover manually with:
  ```sh
  docker compose -f docker-compose.prod.yml run --rm --build db-migrate
  docker compose -f docker-compose.prod.yml up -d
  ```
- **`/api/update/check` returns a GitHub 404**: `GITHUB_TOKEN` is missing or
  lacks access — the repo is private, so unauthenticated requests 404
  instead of 403.
- **`/api/update/check` returns a GitHub 401 Unauthorized**: GitHub received
  a token but rejected it as invalid (as opposed to the 404 above, which
  means *no* usable token). The token is expired, revoked, or malformed —
  a common cause is a doubled prefix (`github_pat_github_pat_…`) from typing
  `github_pat_` before pasting a token that already includes it. Check the
  length (a valid fine-grained PAT is ~93 chars): `awk -F=
  '/^GITHUB_TOKEN=/{print length($2)}' .env`. Fix the value, then recreate
  the container with `docker compose -f docker-compose.prod.yml up -d`
  (a plain `restart` does **not** re-read `.env`).
- **Update button asks for a token you don't want**: `UPDATE_TRIGGER_TOKEN` is
  set in `.env`. Remove the line (and recreate the container) to update without
  one, or keep it — the browser remembers it after the first use.
- **Update reports success / "up to date" but nothing changes**: the update
  script runs `git pull` then `docker compose up -d --build`. If the pull
  succeeds but the rebuild fails (most commonly a full disk — see Disk
  management), the running container is never replaced, so the app stays on
  the old code. The version badge now reflects the *running build* (baked-in
  `APP_GIT_SHA`), so it will honestly keep showing "update available" in this
  case. Read the update log to see exactly why the rebuild failed:
  ```sh
  docker compose -f docker-compose.prod.yml exec main-portal cat /data/update.log
  ```
  (`scripts/update.sh` writes all its output there — the trigger endpoint runs
  it detached, so it does *not* appear in the container logs.)
- **Version badge shows "unknown"**: the image was built without `GIT_SHA`.
  Rebuild with the `GIT_SHA=$(git rev-parse HEAD)` prefix from section 6 (or
  just let a self-update do it — `scripts/update.sh` always sets it).
