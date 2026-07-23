# Multi-stage build for apps/main-portal (pnpm + Turborepo monorepo).
#
# Not verified against an actual `docker build` (no Docker available while
# writing this) — please test locally before relying on it in production.
# See DEPLOYMENT.md for the full deployment walkthrough.

FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

# ---- deps: install workspace dependencies (cached while lockfile is unchanged)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/main-portal/package.json apps/main-portal/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/updater/package.json packages/updater/package.json
RUN pnpm install --frozen-lockfile

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
RUN pnpm build

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
