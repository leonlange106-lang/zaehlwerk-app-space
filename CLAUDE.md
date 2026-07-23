# CLAUDE.md - zaehlwerk-app-space

## Repository Overview
Monorepo for the Zählwerk App-Space OS / Dashboard (`zaehlwerk-app-space`).
- `apps/main-portal`: Next.js App Router (Mantine v7, CSS Modules, Prisma)
- `packages/database`: Prisma schema, client, and DB utils
- `packages/updater`: Self-update engine for GitHub releases

## Core Workflows & Commands
- Install dependencies: `pnpm install`
- Run dev server: `pnpm dev`
- Typecheck: `pnpm typecheck`
- Linting: `pnpm lint`
- Build all packages/apps: `pnpm build`
- DB Migration/Push: `pnpm --filter database db:push`
- DB Seed: `pnpm --filter database db:seed`

## Development & Code Guidelines
- **UI Framework:** Mantine v7 (Use flat imports from `@mantine/core` — e.g.
  `GridCol`, `TableTr` — in Server Components to prevent RSC serialization
  issues; dot-notation like `Grid.Col` only works inside `"use client"`).
- **Styling:** Mantine styles + CSS Modules (no Tailwind).
- **Data Fetching:** Next.js Server Components & Server Actions.
- **Validation:** Zod schemas for all forms and API mutations.
- **Database:** Prisma ORM. Keep logic modular in `packages/database`.

## Task Execution & Git Workflow Rules
1. Always create a dedicated feature branch for new tasks/prompts (`feature/<feature-name>`).
2. Run quality checks before committing: `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
3. Keep commits atomic and concise.
4. **Automated PR & Merge Execution:**
   - Create the PR via GitHub CLI:
     ```bash
     gh pr create --fill
     ```
   - Instantly merge the PR using squash merge and delete the feature branch automatically:
     ```bash
     gh pr merge --squash --delete-branch
     ```
   - (If branch protection rules requiring CI are enabled, use `gh pr merge --auto --squash --delete-branch` instead).
