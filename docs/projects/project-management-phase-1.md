# Project Management — Phase 1 scope

Status: **proposed, not started.** Written 2026-07-30 before any code.

Phase 1 is the spine of a job-costing module: projects, tasks, people, time, and
two board views. Costing rollups, billing and client-facing features are
explicitly later phases — but the data model below is shaped so they can be added
without a rewrite.

The module claims `/projects` and the `ProjectTask` name, both freed deliberately
when CRM "Tasks & Follow-ups" was renamed to "Follow-ups" (2026-07-29).

---

## Three decisions that shape everything else

**1. `remaining_hours` is an independent re-estimate, not `estimate − logged`.**
A task can be estimated at 8h, have 8h logged, and still have 4h remaining — that
is the normal case, not an error. Deriving remaining from estimate minus logged
produces a burndown that always reaches zero on schedule and therefore tells you
nothing. Remaining defaults to the estimate at creation, is suggested as
`max(0, estimate − logged)` when time is logged, and is always overridable.

**2. Burndown requires daily snapshots.** Sprint history cannot be reconstructed
from current task state — once remaining hours change, yesterday's number is
gone. A nightly job writes one `SprintSnapshot` row per active sprint per day.
The alternative (an audit trail of every remaining-hours change, replayed) is
strictly more work for the same chart.

**3. The Bangladesh working week is Sunday–Thursday.** The ideal burndown line
must skip Friday and Saturday or every sprint looks behind schedule for two days
a week. Weekend days are a tenant setting, defaulting to Fri/Sat.

---

## Data model

New Prisma models, one migration.

### `Project`
`id`, `tenant_id`, `store_id?`, `code` (unique per tenant, via `counters`),
`name`, `description?`, `customer_id?`, `lead_id?`, `project_type_id?`,
`status` (`DRAFT | ACTIVE | ON_HOLD | COMPLETED | CANCELLED`), `priority`,
`manager_id` → `User`, `start_date?`, `target_end_date?`, `actual_end_date?`,
`budget_amount?`, `created_by`, timestamps, `deleted_at`.

`budget_amount` is a plain number in Phase 1 — nothing rolls up into it yet.

### `ProjectType`
Tenant-managed master data, same shape and admin pattern as
`LeadSourceOption`/`LeadCategoryOption`: `name`, `is_active`, `sort_order`.

### `ProjectMember`
`project_id`, `user_id`, `role` (`MANAGER | MEMBER | VIEWER`),
unique on `(project_id, user_id)`. Drives "my projects" and per-project
visibility.

### `ProjectMilestone`
`project_id`, `name`, `target_date?`, `completed_at?`, `sort_order`.
Percent-complete is derived from its tasks, not stored.

### `ProjectTaskStatus`
Tenant-managed master data — these *are* the kanban columns.
`name`, `category` (`TODO | IN_PROGRESS | DONE`), `sort_order`, `is_active`,
`is_default`. The `category` field is load-bearing: burndown needs to know what
counts as done, and it must not depend on a column being literally named "Done".

### `ProjectTask`
`project_id`, `milestone_id?`, `sprint_id?`, `parent_task_id?` (one level of
subtask), `title`, `description?`, `status_id`, `priority`, `assignee_id?`,
`due_date?`, `estimate_hours?`, `remaining_hours?`, `sort_order` (board
position), `completed_at?`, `created_by`, timestamps, `deleted_at`.

`logged_hours` is derived from time entries, never stored on the task.

### `ProjectTaskChecklistItem`
`task_id`, `text`, `is_done`, `sort_order`.

### `ProjectTimeEntry`
`task_id`, `project_id` (denormalised for per-project reporting),
`user_id`, `employee_id?`, `work_date`, `hours`, `note?`, `created_at`.

`employee_id` is nullable and unused in Phase 1 — it is the hook Phase 2 needs to
cost hours against `Employee.basic_salary`.

### `Sprint`
`project_id`, `name`, `goal?`, `start_date`, `end_date`,
`status` (`PLANNED | ACTIVE | COMPLETED`). At most one `ACTIVE` sprint per
project, enforced in the service. Sprints are per-project in Phase 1.

### `SprintSnapshot`
`sprint_id`, `snapshot_date`, `remaining_hours`, `committed_hours`,
`completed_hours`, `task_count`, `done_task_count`.
Unique on `(sprint_id, snapshot_date)`.

`committed_hours` is captured so scope added mid-sprint is visible on the chart
rather than silently flattening the line.

### `ProjectComment`
`project_id?`, `task_id?`, `user_id`, `body`, `created_at`. Exactly one of
project/task set. Mentions notify via the existing `Notification` model.

### `ProjectAttachment`
`project_id?`, `task_id?`, `file_url`, `file_name`, `mime_type?`, `file_size?` —
same shape as `VoucherAttachment`, uploaded through the existing `assets` module
pattern.

---

## Backend

`apps/backend/src/projects/` — one module, split by concern:

- `projects.controller.ts` / `projects.service.ts` — project CRUD, list with
  server-side pagination + sorting (`PROJECT_SORTABLE` allowlist, the pattern
  established by Leads and `sales/list`), filters for status/type/manager/
  customer, soft delete
- `project-members.*` — add/remove/change role
- `project-milestones.*` — CRUD + derived percent complete
- `project-tasks.*` — CRUD, subtasks, checklist, bulk status/sort updates for
  drag-and-drop, `PATCH /tasks/:id/move` taking `{statusId, sortOrder, sprintId?}`
- `project-time.*` — log/edit/delete a time entry; logging suggests a new
  `remaining_hours` but never forces it
- `sprints.*` — CRUD, start/complete a sprint, backlog↔sprint assignment,
  `GET /sprints/:id/burndown` returning ideal + actual + scope series
- `project-task-statuses.*` and `project-types.*` — the two master-data sets
- `projects.scheduler.ts` — nightly `SprintSnapshot` writer, registered in
  `JOB_NAMES` and wrapped by `JobTrackerService` like every other cron

All queries scoped by `tenantId` through `TenantInterceptor`. Sort-order writes
use integer rebalancing within a column rather than fractional keys.

## Frontend

`apps/frontend/src/app/(app)/projects/`:

- `page.tsx` — project list, `DataTable` in server mode
- `new/page.tsx`, `[id]/page.tsx` — create and detail (overview, tasks, team,
  milestones, time, comments, attachments)
- `[id]/board/page.tsx` — **one board component, two modes.** Kanban mode shows
  every non-done task by column; scrum mode filters to the active sprint and adds
  the sprint header, remaining-hours totals per column, and the burndown chart.
  They are the same drag-and-drop surface over the same data
- `[id]/backlog/page.tsx` — sprint planning: backlog list, drag into sprint,
  running total of estimated hours against the sprint
- `[id]/burndown` — chart section: ideal line (linear across working days only),
  actual remaining, and a committed-scope line
- `settings/project-setup/page.tsx` — project types and task statuses/columns

`PageShell` + `PageHeader` on every page, `ModalShell` for every modal,
`blue-600` as the only accent, `min-h-touch` targets, `formatBDT()` for the
budget field — per the UI rules. Board columns scroll horizontally inside their
own container so the page body never does at 360px.

Chart library: whatever `dataviz` guidance and the existing dashboard already
use — to be confirmed before building, not assumed.

## Permissions, gating, navigation

- New `projects.*` permissions in `packages/shared-types/index.ts`
  (`projects.view`, `projects.manage`, `tasks.manage`, `time.log`,
  `sprints.manage`), added to `STORE_PERMISSION_LABELS` and
  `STORE_PERMISSION_GROUPS`, with role defaults
- Module gated behind a `projects` platform feature, per-tenant overridable and
  off by default — the same shape as `externalImport`
- Nav registry entry + default layout node, plus `nav-icons`
- en/bn/ms strings for every new label

## Tests

- Service tests for: the remaining-hours suggestion and its override, the
  one-active-sprint rule, board move/reorder, sprint scope changes, snapshot
  idempotency for a same-day re-run, working-day maths across a Fri/Sat weekend,
  percent-complete rollup, and tenant scoping on every query
- Frontend tests for the board in both modes and the burndown series builder

---

## Out of scope for Phase 1

Material issue, project purchases, project expenses, labour costing, cost-center
mapping, budget vs actual, quotation conversion, milestone billing, project P&L,
Gantt/dependencies, workload/resource views, templates, AMC contracts, client
portal, SMS/WhatsApp updates, AI tools. All are Phase 2+.

Also deliberately excluded: story points (burndown is hours-based, as requested),
running timers, and multi-project sprints.

## Open questions

1. Task statuses/columns tenant-wide, or per project type? Tenant-wide is
   proposed — simpler, and one shared board vocabulary.
2. Should a `VIEWER` see time entries and hours, or only tasks?
3. Burndown by remaining hours only, or hours plus task count as a second line?
4. Is `ProductionJob` (manufacturing) eventually a project type, or does it stay
   a separate job-costing engine? Not a Phase 1 blocker, but it decides whether
   Phase 2 builds a second costing path.
