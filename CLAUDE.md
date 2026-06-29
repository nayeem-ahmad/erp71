# CLAUDE.md

Instructions for Claude Code when working in this repository.

---

## TODO List Maintenance

**After completing any task — no exceptions — update `TODO.md`:**

1. Check off completed items by changing `- [ ]` to `- [x]`
2. Move the completed item(s) to the `## COMPLETED` section at the bottom with a short note and today's date: `- [x] Item description — done YYYY-MM-DD`
3. Add any newly discovered work items to the appropriate priority section
4. If a task revealed sub-tasks not previously listed, add them

This applies to every session, every change, every fix — even small ones.

---

## Project Overview

ERP71 platform targeting Bangladeshi small/medium retailers. Monorepo:

- `apps/backend` — NestJS REST API
- `apps/frontend` — Next.js 15 app
- `apps/mobile` — Flutter (not started)
- `packages/database` — Prisma schema + migrations
- `packages/shared-types` — shared TypeScript types and permission matrix

**Stack:** NestJS, Next.js 15, PostgreSQL, Prisma, Tailwind CSS, Zustand, JWT auth  
**Payments:** SSL Wireless, bKash, Nagad (Bangladesh-local providers)  
**Deployment:** Render.com, Docker

---

## Git Branch Policy

**All day-to-day development happens on `dev`.** `main` is the release/production branch.

| Branch | Purpose |
|--------|---------|
| `dev` | Default branch — feature work, fixes, experiments |
| `main` | Production-ready code — merge from `dev` via pull request only |

**Workflow:**
1. `git checkout dev` before starting work
2. Commit and push to `dev`
3. Open a PR `dev` → `main` when ready to release

**Enforcement (local):** `.githooks/` blocks commits on `main` and direct pushes to `main`.
Hooks install automatically via `npm install` (`prepare` script). Manual setup: `bash scripts/setup-git-hooks.sh`.

Emergency override (use sparingly): `ALLOW_MAIN_COMMIT=1` / `ALLOW_MAIN_PUSH=1`.

---

## Key Conventions

- All backend modules live in `apps/backend/src/<module>/`
- Multi-tenancy is enforced via `TenantInterceptor` — all business queries must be scoped to `tenantId`
- Permissions are defined in `packages/shared-types/index.ts` — add new permissions there first
- Database changes require a Prisma migration (`npm run db:migrate` in `packages/database`)
- Seed data is in `packages/database/prisma/seed.ts`
