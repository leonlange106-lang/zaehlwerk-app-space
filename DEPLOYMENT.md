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

## 3. Clone the repository

```sh
mkdir -p /opt/zaehlwerk
git clone https://github.com/leonlange106-lang/zaehlwerk-app-space.git /opt/zaehlwerk
cd /opt/zaehlwerk
```

This checkout is what gets bind-mounted into the container and is what
`git pull` operates on during a self-update — keep it on the branch you want
running in production (typically `main`).

## 4. Configure environment variables

Create `/opt/zaehlwerk/.env` (read by `docker compose`, **not** committed):

```sh
cat > .env <<'EOF'
# Fine-grained GitHub PAT, read-only "Contents" access to this repo — needed
# because the repo is private and /api/update/check hits GitHub's API.
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxx

# Shared secret required to POST /api/update/trigger. Generate a random one:
#   openssl rand -hex 32
UPDATE_TRIGGER_TOKEN=REPLACE_ME
EOF
chmod 600 .env
```

## 5. Build and start

```sh
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f main-portal
```

The app listens on port `3000`. First run seeds nothing automatically — if
you want the demo data, run once:

```sh
docker compose -f docker-compose.prod.yml exec main-portal \
  node -e "process.chdir('/repo/packages/database'); require('child_process').execSync('pnpm db:push && pnpm db:seed', {stdio:'inherit'})"
```

(or simpler, run `pnpm db:push && pnpm db:seed` on the host if you have
Node/pnpm installed there against the same `DATABASE_URL`.)

## 6. Put it behind a reverse proxy (recommended)

Don't expose port 3000 directly to the internet. Put a reverse proxy in
front (Caddy, Traefik, or nginx — on the Proxmox host, in another LXC, or on
your existing edge router) that terminates TLS and forwards to
`http://<lxc-ip>:3000`. Example Caddy snippet:

```
zaehlwerk.example.com {
  reverse_proxy <lxc-ip>:3000
}
```

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

## Troubleshooting

- **`prisma generate` fails during build with a permissions/rename error**:
  usually a stale file lock from a previous failed build; `docker compose
  build --no-cache` clears it.
- **`/api/update/check` returns a GitHub 404**: `GITHUB_TOKEN` is missing or
  lacks access — the repo is private, so unauthenticated requests 404
  instead of 403.
- **`/api/update/trigger` returns 503**: `UPDATE_TRIGGER_TOKEN` isn't set in
  `.env`.
- **Update trigger runs but nothing changes**: check
  `docker compose logs main-portal` around the trigger time — `scripts/update.sh`
  writes its progress to stdout, which lands in the container logs since it's
  spawned as a child process of the app.
