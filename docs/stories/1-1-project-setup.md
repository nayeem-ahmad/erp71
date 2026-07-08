# Story 1.1: Project & Infrastructure Setup

Status: done

## Story

As a DevOps Engineer,
I want to set up the initial monorepo, CI/CD pipeline, and cloud infrastructure,
so that the development team can start building and deploying the application.

## Acceptance Criteria

1.  A Git monorepo is created with `apps/web` and `packages/shared-types` using npm workspaces. [x]
2.  Vercel is linked for deployment of the `apps/web` (Next.js App Router). [x]
3.  `.env.local` is configured with Supabase connection strings from the PRD. [x]

## Tasks / Subtasks

- [x] Task 1: Initialize Monorepo Structure
  - [x] Create `package.json` at root with `workspaces`.
  - [x] Create `apps/web` folder and initialize Next.js App Router.
  - [x] Create `packages/shared-types` folder.
- [x] Task 2: Configure CI/CD
  - [x] Set up `.github/workflows/deploy.yaml` for Vercel.
  - [x] Ensure `lint` and `build` pass on every PR.
- [x] Task 3: Setup Environment
  - [x] Create `.env.example` with Supabase keys.
  - [x] Verify `npm install` works across the workspace.

## Dev Notes

- **Tech Stack:** Next.js 16.1.7 (App Router), TypeScript, Tailwind CSS.
- **Unified Project Structure:** Follow `docs/architecture/unified-project-structure.md`.
- **Naming Conventions:** Use PascalCase for components, camelCase for hooks.

### Project Structure Notes

- Alignment with `saas-platform-for-grocery-shops/` structure from PRD.
- Root `package.json` now manages `apps/*` and `packages/*` workspaces.

### References

- [Source: docs/architecture/unified-project-structure.md]
- [Source: docs/architecture/development-workflow.md]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Initialized npm workspaces and created `apps/web` using `create-next-app`.
- Task 2: Configured `.github/workflows/deploy.yaml` for quality checks.
- Task 3: Created `.env.example` and verified build/lint.

### Completion Notes List

- Successfully initialized the monorepo structure.
- Created the Next.js App Router in `apps/web`.
- Set up a CI/CD pipeline to ensure code quality.
- Verified that the project builds and lints correctly across all workspaces.

### File List

- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/page.tsx`
- `packages/shared-types/package.json`
- `packages/shared-types/index.ts`
- `.github/workflows/deploy.yaml`
- `.env.example`
