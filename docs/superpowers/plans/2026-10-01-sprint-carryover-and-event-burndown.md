# Sprint carry-over, history and every-change burndown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completing a sprint carries unfinished tasks to a new/planned sprint or the backlog; every task keeps the sprints it was attempted in; the sprint burndown stores and plots a point on every change.

**Architecture:** `ProjectTask.sprint_id` stays the *current* sprint. A new `SprintTask` table holds one row per task per sprint, written only by `SprintMembershipService`. A new `SprintBurndownPoint` table replaces `SprintSnapshot`; `BurndownRecorder.record()` replaces `SprintSnapshotService.refresh()` at every existing call site and stores full recomputed totals with a cause. The frontend gains a Complete dialog, a "Sprints" fact on the task card, carried-task badges on completed sprints, and a time-axis step-line burndown.

**Tech Stack:** NestJS + Prisma (Postgres), Jest with mocked `DatabaseService`; Next.js 15 + Vitest + Testing Library; hand-rolled SVG chart.

**Spec:** `docs/superpowers/specs/2026-10-01-sprint-carryover-and-event-burndown-design.md`

## Global Constraints

- A task has at most one open `SprintTask` row (`removed_at IS NULL`), always matching `ProjectTask.sprint_id` — partial unique index `sprint_tasks_one_open`.
- Nothing outside `SprintMembershipService` assigns `sprint_id` on `ProjectTask` (enforced by a source-scan test, like the one `remaining-hours.service.spec.ts` has for `remaining_hours`).
- `BurndownRecorder.record` never throws, ignores non-ACTIVE sprints, skips a point identical to the latest one (except `STARTED`/`COMPLETED`).
- `POST /sprints/:id/complete` with no body behaves as today (backlog).
- UI: `ModalShell`, `@/components/ui` primitives, `blue-600` accent, amber/emerald/red semantics, toasts via global `toast`, inline field errors, `min-h-touch` targets, new strings in all nine `projects.ts` catalogues.
- Multi-tenancy: every query scoped by `tenant_id`.

## Review Focus

1. **A task deleted while in an active sprint** — it must drop out of the sprint's totals and history must show it `REMOVED`, not leave an open row pointing at a deleted task. Test in Task 3.
2. **Board drag between sprint lanes** (`move` with `sprintId`/`clearSprint`) — history must close/open rows inside the existing transaction. Test in Task 3.
3. **Completing a sprint whose tasks are all Done** — no carry choice, no new sprint created even if `carryTo.kind = 'new'` was sent. Test in Task 4.
4. **Name increment edge cases** — "Sprint 9" → "Sprint 10", "Q3 sprint" → "Q3 sprint 2", "Release 2.1" → "Release 2.2". Test in Task 7.
5. **A sprint with hundreds of points / a sprint with zero points** — chart must render both (empty → ideal only). Test in Task 8.

---

## File Structure

Backend (`apps/backend/src/projects/`):
- `sprint-membership.service.ts` (new) — the only writer of `ProjectTask.sprint_id` + `SprintTask`.
- `burndown-recorder.service.ts` (new) — `computeCurrent`, `record`; replaces `sprint-snapshot.service.ts` (deleted, with its spec).
- `sprints.service.ts` — complete-with-carry, guards, burndown read from points.
- `project-tasks.service.ts`, `projects.service.ts`, `remaining-hours.service.ts`, `project-tasks list` — call sites.
- `projects.scheduler.ts` — snapshot cron removed.
- `project.dto.ts` — `CompleteSprintDto`, `UpdateSprintDto` loses `status`.

Database: `schema.prisma` + migration `20261001150000_sprint_history_and_burndown_points`; `prisma/backfill-sprint-history.ts`.

Frontend (`apps/frontend/src/`):
- `components/projects/complete-sprint-defaults.ts` (new, pure) + `CompleteSprintModal.tsx` (new).
- `components/projects/BurndownChart.tsx` — time-axis mode; `components/projects/burndown-steps.ts` (new, pure path maths).
- `app/(app)/projects/sprints/page.tsx`, `sprints/[id]/page.tsx`, task card body — wiring.
- `lib/api.ts`, nine `lib/localization/messages/*/projects.ts`.

---

### Task 1: Schema + migration

**Files:** Modify `packages/database/prisma/schema.prisma`; Create `packages/database/prisma/migrations/20261001150000_sprint_history_and_burndown_points/migration.sql`.

**Produces:** Prisma models `SprintTask` (`db.sprintTask`), `SprintBurndownPoint` (`db.sprintBurndownPoint`), enums `SprintTaskOutcome`, `BurndownCause`; relations `ProjectTask.sprintMemberships`, `Sprint.memberships`, `Sprint.carriedIn`, `Sprint.burndownPoints`.

- [ ] Add models exactly as the spec's tables (relation names `SprintTaskSprint`, `SprintTaskCarriedTo`), back-relations on `Sprint`, `ProjectTask`, `Tenant`.
- [ ] Write migration SQL: two enums, two tables, FKs (`sprint_id` cascade, `task_id` cascade, `carried_to_sprint_id` set null, point `task_id` set null), indexes, and `CREATE UNIQUE INDEX "sprint_tasks_one_open" ON "sprint_tasks"("task_id") WHERE "removed_at" IS NULL;`.
- [ ] `npx prisma validate` and `npx prisma generate`; verify migration SQL matches `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script` (except the partial index, which Prisma cannot express).
- [ ] Commit.

### Task 2: `BurndownRecorder` replaces `SprintSnapshotService`

**Files:** Create `burndown-recorder.service.ts` + `.spec.ts`; delete `sprint-snapshot.service.ts` + spec; modify `projects.module.ts`, `projects.scheduler.ts` (+spec), `system-health/jobs/job-names.ts`, every `snapshots.refresh/snapshotToday` caller, `remaining-hours.service.ts`.

**Produces:**
```ts
export type BurndownCauseName = 'STARTED'|'WORK_LOGGED'|'RE_ESTIMATED'|'TASK_ADDED'|'TASK_REMOVED'|'STATUS_CHANGED'|'COMPLETED'|'BACKFILLED';
export interface BurndownFigures { remaining_hours: number; committed_hours: number; task_count: number; done_task_count: number }
class BurndownRecorder {
  computeCurrent(tenantId: string, sprintId: string): Promise<BurndownFigures>;
  record(tenantId: string, sprintIds: Array<string|null|undefined>, cause: BurndownCauseName, taskId?: string|null): Promise<void>;
  static causeForSource(source: string): BurndownCauseName; // TIME_LOGGED/TIME_ENTRY_DELETED→WORK_LOGGED, RE_ESTIMATED/TASK_CREATED→RE_ESTIMATED, TASK_COMPLETED/TASK_REOPENED→STATUS_CHANGED
}
```

Tests (write first, see them fail, implement, pass):
- records a point with recomputed totals for an ACTIVE sprint, with cause and task id
- writes nothing for PLANNED/COMPLETED sprints and for null ids; dedupes ids
- skips a point whose four figures equal the latest point's; still writes `STARTED`/`COMPLETED` when equal
- swallows a DB error (resolves, logs)
- `causeForSource` mapping

Call-site causes: `RemainingHoursService.write` → `causeForSource(write.source)` with `write.taskId`; `create` → `TASK_ADDED`; `update`/`move` → `TASK_REMOVED` on the left sprint and `TASK_ADDED` on the joined one (recorded right after the row update, before remaining writes) and `STATUS_CHANGED` at the end; `remove`/`bulkRemove` → `TASK_REMOVED`; `assignTasks`/`assignStories` → `TASK_ADDED` (+`TASK_REMOVED` on left sprints); `removeTasks` → `TASK_REMOVED`; `start` → `STARTED`; `complete` → `COMPLETED`. Remove the cron + `JOB_NAMES.PROJECTS_SPRINT_SNAPSHOTS` and `POST /sprints/:id/rebuild-snapshots` (+ `api.rebuildSprintSnapshots`).

`burndown()` in `SprintsService` reads points (Task 5) — until then keep it compiling by reading `sprintBurndownPoint` with a minimal mapping.

- [ ] Run `npx jest src/projects` — all green. Commit.

### Task 3: `SprintMembershipService` + all `sprint_id` writers

**Files:** Create `sprint-membership.service.ts` + `.spec.ts`; modify `sprints.service.ts` (assignTasks, assignStories, removeTasks), `project-tasks.service.ts` (create, update, move, remove, bulkRemove, applyMove if it writes sprint), `projects.service.ts` (remove), their specs.

**Produces:**
```ts
type Client = Pick<DatabaseService, 'projectTask' | 'sprintTask'>;
type Outcome = 'DONE' | 'CARRIED_OVER' | 'RETURNED_TO_BACKLOG' | 'REMOVED';
class SprintMembershipService {
  moveTasks(client: Client, tenantId: string, taskIds: string[], toSprintId: string | null,
            closeAs: Outcome, opts?: { carriedToSprintId?: string | null; at?: Date })
    : Promise<{ moved: number; leftSprintIds: string[] }>;
  closeInPlace(client: Client, tenantId: string, sprintId: string, taskIds: string[], outcome: Outcome, at?: Date): Promise<number>; // closes rows, leaves sprint_id (Done tasks on complete)
}
```
`moveTasks` reads the tasks (`id, sprint_id, remaining_hours`), skips those already in `toSprintId`, closes their open rows (`updateMany where task_id in, removed_at null` → `removed_at, outcome, carried_to_sprint_id`; `remaining_at_close` per task via individual `update` on the open row), `updateMany` `sprint_id`, `createMany` new rows when `toSprintId`.

Tests:
- opens a row for a task joining from the backlog; closes + opens when switching sprints; skips a task already there
- `toSprintId = null` closes only
- records `remaining_at_close` and `carried_to_sprint_id`
- returns distinct `leftSprintIds`
- source scan: no file in `src/projects` other than `sprint-membership.service.ts` contains `sprint_id:` inside a `projectTask.update`/`updateMany`/`create` data block (grep for `sprint_id: ` in `data:` contexts — implemented as a regex over source, allowing `where` clauses)
- task delete (single and bulk) closes the row `REMOVED` and clears `sprint_id` (Review Focus 1)
- board `move` with `sprintId` uses the transaction client (Review Focus 2)
- assign/remove on a COMPLETED sprint → 400

- [ ] Commit.

### Task 4: Complete with carry-over + guards

**Files:** `project.dto.ts` (`CompleteSprintDto`, `CarryToDto`; `UpdateSprintDto` keeps `status` field but service rejects it), `sprints.controller.ts`, `sprints.service.ts`, spec.

**Consumes:** `SprintMembershipService.moveTasks/closeInPlace`, `BurndownRecorder.record`.
**Produces:** `complete(tenantId, sprintId, dto?: CompleteSprintDto)` → `{ ...sprint, carried_over: number, carried_to: { id, name } | null }`.

DTO: `carryTo?: { kind: 'backlog'|'sprint'|'new'; sprintId?; name?; startDate?; endDate?; goal?; start?: boolean }` validated with `@ValidateIf` per kind.

Flow per spec §Completing a sprint. Tests:
- no body → unfinished to backlog, rows closed `RETURNED_TO_BACKLOG`, Done rows closed `DONE` in place
- `kind: 'new'` creates the sprint, moves tasks `CARRIED_OVER` with `carriedToSprintId`, returns `carried_to`
- `kind: 'new', start: true` activates it and records `STARTED`
- `kind: 'sprint'` into a PLANNED sprint; ACTIVE/COMPLETED/missing target → 400
- second complete → 409 (`updateMany` count 0)
- all tasks Done + `kind: 'new'` → no sprint created (Review Focus 3)
- `COMPLETED` point recorded before tasks leave
- `PATCH` with `status` → 400

- [ ] Commit.

### Task 5: Reads — burndown points, sprint-filtered task list, task history

**Files:** `sprints.service.ts` (`burndown`), `project-tasks.service.ts` (list filter + `findOne` include), specs.

- `burndown(tenantId, sprintId)` → `{ sprint, current, ideal: {date, value}[], points: {at, remaining, committed, open, cause, task}[] }`. Ideal from `buildBurndownSeries` (committed = first point's committed, else current). For ACTIVE, append a synthetic `{ at: now, ...current, cause: null }` when it differs from the last point.
- list with `sprintId`: `where.sprintMemberships = { some: { sprint_id, OR: [{ removed_at: null }, { outcome: { not: 'REMOVED' } }] } }` and include that membership as `sprintMembership` (`outcome`, `remaining_at_close`, `carried_to { id, name }`).
- `findOne` adds `sprintHistory` (oldest first: sprint id/name/status, added_at, removed_at, outcome).

Tests: burndown maps points + appends live point; list filter shape; carried task appears with membership; `findOne` history order.

- [ ] Commit.

### Task 6: Backfill script

**Files:** Create `packages/database/prisma/backfill-sprint-history.ts`; add `backfill:sprint-history` script to `packages/database/package.json`; runbook section in `docs/ops/deployment-runbook.md`.

Logic per spec §Backfill; report-only unless `--apply`; idempotent (skip sprints with any `sprint_tasks` rows / any points). Pure helpers exported (`replayPoints(logs, snapshots, tz)`, `historyRows(...)`) with a Jest-free node:test or a backend spec importing them — put the pure helpers in `apps/backend/src/projects/sprint-backfill.util.ts` with a spec, and have the script import the compiled logic by relative path like `backfill-task-remaining.ts` does (check its imports first; if it is self-contained, keep the script self-contained and test the util copy).

- [ ] Verify against a scratch Postgres DB (create db, `prisma migrate deploy`, seed sprints/tasks/logs, run report, `--apply`, rerun = no-op).
- [ ] Commit.

### Task 7: Complete dialog (frontend)

**Files:** Create `components/projects/complete-sprint-defaults.ts` (+test), `components/projects/CompleteSprintModal.tsx` (+test); modify `app/(app)/projects/sprints/page.tsx`, `sprints/[id]/page.tsx`, `lib/api.ts` (`completeSprint(id, body?)`, drop `rebuildSprintSnapshots`), nine `projects.ts`.

**Produces:** `nextSprintName(name: string): string`; `nextSprintDates(start: string, end: string): { startDate: string; endDate: string }` (date keys); `<CompleteSprintModal sprint onClose onCompleted />`.

Tests: name increment cases (Review Focus 4); dates keep length; modal defaults to new sprint with prefilled fields; planned option disabled with none; no radio when nothing unfinished; inline error for empty name/end before start; submits the right body per choice.

- [ ] Commit.

### Task 8: Time-axis step burndown (frontend)

**Files:** Create `components/projects/burndown-steps.ts` (+test); modify `BurndownChart.tsx` (+test), `sprints/[id]/page.tsx` (feed points).

**Produces:** `stepPath(points: {t: number; v: number}[], x: (t)=>number, y: (v)=>number): string`; `nearestPoint(points, t): index`; `BurndownChart` prop `timeline?: { start: string; end: string; points: TimelinePoint[]; ideal: {date,value}[] }` — when given, renders the time-axis mode; the existing `series` mode is untouched for projects.

Tests: step path shape; nearest point; zero points renders ideal only; 500 points render one path, markers only for scope causes (Review Focus 5); hover shows cause + task.

- [ ] Commit.

### Task 9: Task card history + completed sprint badges

**Files:** task card body (`components/projects/task-card/*` facts), `sprint-table.ts` type, sprint detail table/cards for the "→ Sprint N" badge; locale strings.

Tests: Sprints fact hidden with one or zero history rows and no current sprint... (shown when ≥1 row); badge renders for `CARRIED_OVER`.

- [ ] Commit.

### Task 10: Verification + TODO

- [ ] `npx jest src/projects` (backend), frontend `vitest run` on touched dirs + `catalog.test.ts`, `tsc --noEmit` both apps (compare error counts with base), `next lint --quiet`.
- [ ] Update `TODO.md` (move item to COMPLETED; add follow-ups: drop `SprintSnapshot`, run backfill in prod).
- [ ] Commit.
