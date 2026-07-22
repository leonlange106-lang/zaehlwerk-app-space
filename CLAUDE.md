# Monorepo Guidelines & Workflow

## Workflow Rules
- NEVER commit directly to `main`. Always create a `feature/<name>` branch.
- Run typechecks and lints before opening a Pull Request.
- Create Pull Requests via `gh pr create --fill` and stop there (do NOT merge).

## Monorepo Architecture
- Root manages shared configurations, Docker setups, and Turborepo orchestrations.
- `apps/` contains all sub-applications (`main-portal`, `zaehlwerk`, `ios`, etc.).
- `packages/` contains shared UI (`packages/ui`), TypeScript configs (`packages/config-typescript`), and ESLint rules.
- UI Strategy: Web applications use **Mantine UI (v7)** exclusively.

## Commands
- Build: `pnpm build`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
