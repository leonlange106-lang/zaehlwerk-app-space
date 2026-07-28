# syntax=docker/dockerfile:1
# Multi-stage build for apps/main-portal (pnpm + Turborepo monorepo).
#
# Speed: uses BuildKit cache mounts (needs DOCKER_BUILDKIT=1 — scripts/update.sh
# sets it) so the pnpm store and Next's build cache PERSIST across rebuilds. That
# turns the self-update's `next build` from fully cold into incremental. If a
# build ever errors on the `--mount` syntax, BuildKit isn't active — export
# DOCKER_BUILDKIT=1 (or install buildx). See DEPLOYMENT.md.

FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

# ---- deps: install workspace dependencies (cached while lockfile is unchanged)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/main-portal/package.json apps/main-portal/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/updater/package.json packages/updater/package.json
# Cache mount for the pnpm content-addressable store → downloads are reused
# across builds even when the lockfile changes (node_modules itself is copied
# into the image layer, so the result stays self-contained).
RUN --mount=type=cache,id=zw-pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

# ---- builder: generate the Prisma client and build main-portal
FROM base AS builder
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/main-portal/node_modules ./apps/main-portal/node_modules
COPY --from=deps /repo/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /repo/packages/updater/node_modules ./packages/updater/node_modules
COPY . .
# `prisma generate` only reads the schema, but still needs DATABASE_URL to be
# set for its config loader — this placeholder is never actually connected to.
# It's also never queried during `next build`: every DB-backed route is
# `export const dynamic = "force-dynamic"`, so Next renders them at request
# time instead of trying (and failing) to prerender them against a database
# that doesn't exist yet at build time.
ENV DATABASE_URL="file:./build-placeholder.db"
# Root `build` script (turbo run build) builds every package in dependency
# order — @zaehlwerk/database and @zaehlwerk/updater compile to dist/ first
# (via their own "build" scripts), then main-portal. Building main-portal
# alone via `pnpm --filter main-portal build` would skip that and leave it
# importing packages that were never compiled.
#
# Cache mounts persist Next's webpack cache and Turbo's cache across builds, so
# an incremental rebuild only recompiles what actually changed instead of the
# whole app every time. The mounts themselves are BuildKit state and never land
# in a layer.
#
# The standalone output is the catch, though: `next build` copies the whole
# `.next/` tree into `.next/standalone/…/.next/`, and it does that while the
# cache mount is still attached — so the webpack cache gets COPIED out of the
# mount into a real directory that the runner then ships. That was ~1.2 GB of
# pure garbage per image and it is what made `docker compose build` die with
# ENOSPC while unpacking the layer. Drop it inside the same RUN, so the bytes
# are gone before the layer is committed (deleting it later would not shrink
# anything — the earlier layer would still carry it).
# Einbettungs-Richtlinie. MUSS hier stehen, nicht im Runner: next.config.ts liest
# diese Werte, waehrend `next build` laeuft, und backt die fertige
# Content-Security-Policy in die Ausgabe. Als `environment:` in der Compose
# gesetzt waeren sie reine Laufzeit und blieben wirkungslos — der Header stuende
# zu dem Zeitpunkt laengst fest.
#
# Standard ist "nicht einbettbar" (frame-ancestors 'none' + X-Frame-Options:
# DENY), und das bleibt richtig fuer eine direkt aufgerufene Instanz. Wer die App
# in Home Assistant als iframe zeigt, traegt dessen Origin ein — Schema und Port
# inklusive:
#   FRAME_ANCESTORS="http://192.168.178.50:8123"
ARG FRAME_ANCESTORS=""
ARG HA_INGRESS=""
ENV FRAME_ANCESTORS=$FRAME_ANCESTORS
ENV HA_INGRESS=$HA_INGRESS

RUN --mount=type=cache,id=zw-next-cache,target=/repo/apps/main-portal/.next/cache \
    --mount=type=cache,id=zw-turbo-cache,target=/repo/.turbo \
    pnpm build \
 && rm -rf apps/main-portal/.next/standalone/apps/main-portal/.next/cache

# ---- migrator: der builder plus Docker-CLI
#
# Nur dafuer da, die Migration auszufuehren (Compose-Dienst `db-migrate`).
#
# Warum die CLI dort hinein muss: Prismas Schema-Engine vertraegt neben sich
# keine offene Transaktion — auch keine LESENDE, auch im WAL-Modus. Gemessen,
# siehe docs/migrations.md. Eine laufende Anwendung hat staendig welche, also
# muss die Migration die Anwendung anhalten koennen.
#
# Warum eine eigene Stufe statt eines `apk add` im builder: Der builder baut
# auch die Anwendung. Ein Paket, das nur die Migration braucht, gehoert nicht
# in jeden App-Build.
FROM builder AS migrator
RUN apk add --no-cache docker-cli docker-cli-compose

# ---- runner: minimal production image
#
# Runs as root, deliberately: the update-trigger endpoint needs `git` and the
# Docker CLI talking to the host's Docker socket (docker-outside-of-docker,
# see docker-compose.prod.yml) to pull + rebuild + restart. Mounting that
# socket already grants root-equivalent host access regardless of the
# container's UID, so a non-root user here would be a false sense of
# isolation. Keep the update-trigger endpoint off the public internet — see
# DEPLOYMENT.md.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git docker-cli docker-cli-compose

# Commit this image was built from, baked in so the app reports the version it
# is ACTUALLY running (not the git checkout, which a pull can advance past a
# failed rebuild). Passed via docker-compose build.args from scripts/update.sh
# (`GIT_SHA=$(git rev-parse HEAD)`); "unknown" if a manual build omits it.
ARG GIT_SHA=unknown
ENV APP_GIT_SHA=$GIT_SHA

COPY --from=builder /repo/apps/main-portal/.next/standalone ./
COPY --from=builder /repo/apps/main-portal/.next/static ./apps/main-portal/.next/static
COPY --from=builder /repo/apps/main-portal/public ./apps/main-portal/public
COPY --from=builder /repo/scripts ./scripts

# Prisma's runtime searches a handful of __dirname-relative locations for its
# query engine binary, and both bundlers we tried (Turbopack, then webpack —
# see PR history) rewrite/relocate the code that computes those enough that
# none of the candidates end up correct at runtime, even though the binary
# genuinely is present at packages/database/generated/client/. Sidestep the
# search entirely by pointing straight at the file. The filename is tied to
# this base image's OpenSSL version (Alpine 3.x → openssl-3.0.x); if the
# node:20-alpine tag ever moves to a different OpenSSL major, `prisma
# generate`'s output filename changes too and this needs updating to match
# (check with: docker compose exec main-portal ls /app/packages/database/generated/client).
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/packages/database/generated/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

RUN mkdir -p /data

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/main-portal/server.js"]
