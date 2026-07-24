# CLAUDE.md — zaehlwerk-app-space

Monorepo (pnpm + Turbo) for the Zählwerk App-Space dashboard. German UI.
- `apps/main-portal` — Next.js 16 App Router · Mantine v7 · CSS Modules · Recharts · Prisma 6 · SQLite · Auth.js · Vitest + Playwright
- `packages/database` — Prisma schema + client, exposed as `@zaehlwerk/database` (`import { prisma } from "@zaehlwerk/database"`)
- `packages/updater` — self-update engine (`@zaehlwerk/updater`)

## Commands
- `pnpm install` · `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
- Tests (run from `apps/main-portal`): `pnpm test` (vitest unit), `pnpm test:e2e` (playwright)
- DB: `pnpm --filter database db:push` (schema-push, **no migration files**) · `db:seed`

## Conventions (override defaults)
- **Mantine v7:** flat imports (`GridCol`, `TableTr`) in Server Components — dot-notation (`Grid.Col`) only inside `"use client"`.
- Styling: Mantine + CSS Modules. **No Tailwind.**
- Data via Server Components / Server Actions. **Zod** for all form/API validation. Prisma for DB (keep logic in `packages/database`).
- Unit tests colocated `*.test.ts` (vitest); pure/framework-free logic in `lib/` is the unit-test surface.

## Git workflow (per task)
1. Dedicated feature branch: `feature/<name>` — **never work on `main`**.
2. Before committing: `pnpm typecheck`, `pnpm lint`, `pnpm build` (+ relevant tests). Atomic, concise commits.
3. `gh pr create --fill` → `gh pr merge --squash --delete-branch` (use `--auto` if branch protection requires CI). Then `git checkout main && git pull`.
4. Don't stage e2e artifacts (`e2e/.auth`, `e2e/.data`, `e2e/.report`).

## Where things live (paths under `apps/main-portal/app`)
- **Log Analyzer** (main feature): UI in `apps/log-analyzer/*View.tsx` + `EvaluationCard/LogCharts/ParameterPanel/VehicleSpecForm.tsx`; pure logic + colocated `*.test.ts` in `apps/log-analyzer/lib/` — eval engine `lib/evaluate-log-pull.ts`, thresholds `lib/engines.ts` + `lib/vehicle-spec.ts` + `lib/catalog.ts`, parsing `lib/log-parser.ts` + `lib/channels.ts` + `lib/parameters.ts`.
- **Persisted logs** (`LogFile`): server `lib/log-repository.ts`, REST `api/apps/log-analyzer/logs/` (+`/[id]`), client `apps/log-analyzer/lib/log-api.ts`.
- **System Update:** `lib/update-status.ts` + `lib/update-state.ts`, SSE/API `api/system/update/`, UI `settings/SettingsView.tsx`; shell `scripts/update.sh` + `scripts/deploy-swap.sh`.
- **Admin / metrics:** `AdminPanel.tsx`, `lib/system-metrics.ts`, `api/system/metrics/` + `api/system/cache/clear/`; mounted in `page.tsx` (admin-only).
- **Auth/roles:** `lib/auth-helpers.ts` (`getSessionUser`, `requireAdmin`); audit `lib/audit.ts`. **Prisma schema:** `packages/database/prisma/schema.prisma`.
- **Automated log ingestion:** API `api/v1/logs/ingest/` (auth `lib/ingestion-auth.ts` — `X-API-Key`/Bearer, `IngestionKey` model + `INGESTION_API_KEY` env bootstrap; keys managed in `lib/ingestion-key-actions.ts` + `settings/IngestionKeyCard.tsx`). Orchestration `lib/log-ingest.ts` (SHA-256 dedup via `LogFile.contentHash`). Watch-folder `apps/log-analyzer/watcher/` (polling; `LOG_WATCH_DIR`, started in `instrumentation.ts`). Realtime `lib/log-events.ts` bus → SSE `api/apps/log-analyzer/logs/stream/` → `HistoryView` toast.

## Gotchas (non-obvious)
- **Schema changes apply on deploy** via the self-update's `prisma db push` — a running System Update is required before new columns/tables exist in prod. The generated Prisma client is git-ignored (rebuilt on build).
- Prod runs in a Docker container on an LXC that is **recreated mid-update** → in-memory server state is lost. Persistent truth = the `/data` volume (update status/log) and the DB. Disk (LXC) is the recurring ENOSPC cause.
- No global auth middleware on API routes — admin-only routes check `getSessionUser().role` explicitly.
