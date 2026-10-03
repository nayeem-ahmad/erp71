# Sprint carry-over, sprint history, and an every-change burndown

**Date:** 2026-10-01
**Status:** Draft pending review
**Asked as:** (1) when a sprint is completed, create a new sprint holding all
unfinished items (not the ones in Done); (2) let one task be in multiple
sprints, so it is visible that it was attempted more than once; (3) the
burndown should plot every point — each time a task's remaining hours change,
store the sprint's total remaining hours with a timestamp.

---

## Problem

`SprintsService.complete` sets `sprint_id = null` on every task whose status
category is not `DONE`. The unfinished work lands in the general backlog with
nothing recording which sprint it came from, so building the next sprint means
picking those tasks out of the whole backlog from memory. The completed sprint
also loses them: its page afterwards shows only the Done tasks, as if the rest
had never been committed.

A task has exactly one `sprint_id`. Nothing records the sprints it was in
before, so "this has slipped three sprints" is invisible.

The sprint burndown reads `SprintSnapshot`, one row per sprint per day. A
change mid-day overwrites today's row; the chart cannot show what happened
between two days, and scope added mid-sprint is indistinguishable from work
going backwards.

## Goals

- Completing a sprint asks where the unfinished tasks go — a **new sprint**
  (default, prefilled), an **existing planned sprint**, or the **backlog** —
  and does it in one transaction.
- Every task keeps a record of every sprint it was in and how each one ended
  for it (done, carried over, returned to backlog, removed). The task card
  shows it; a completed sprint's page lists its carried tasks again.
- Every change to an active sprint's totals stores a burndown point: a
  timestamp, the full totals at that moment, and what caused it. The chart
  plots all of them on a time axis.

## Decisions taken in chat

- **History, not simultaneous membership.** A task is in at most **one open
  (PLANNED or ACTIVE) sprint** at a time. "Multiple sprints" means its history
  of past ones. `ProjectTask.sprint_id` stays as the current sprint, so its
  ~145 readers keep their meaning; history is a new table beside it.
- **Every change to the total records a point**, not only remaining-hours
  changes: tasks added/removed (scope) and tasks moving to/from Done (the
  open-tasks line) too, each tagged with its cause.

## Non-goals

- A task in two open sprints at once.
- Choosing individual tasks to carry in the Complete dialog — remove them from
  the new sprint afterwards.
- Recording points for PLANNED sprints (changes before start are planning).
- Changing the **project** burndown, which keeps its daily series replayed
  from `ProjectTaskRemainingLog`.
- Velocity / story-point rollups across sprints (the history table makes them
  possible later; not built here).
- Per-viewer burndowns for private projects (unchanged — see the existing TODO).

---

## Data model

Two new tables, one enum each, one migration.

### `SprintTask` — a task's membership in one sprint

| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `tenant_id` | String | |
| `sprint_id` | String | FK `Sprint`, `onDelete: Cascade` — deleting a sprint deletes its history |
| `task_id` | String | FK `ProjectTask`, `onDelete: Cascade` |
| `added_at` | DateTime | |
| `removed_at` | DateTime? | null = open |
| `outcome` | `SprintTaskOutcome?` | set when closed |
| `remaining_at_close` | Decimal(8,2)? | the task's remaining hours when the row closed |
| `carried_to_sprint_id` | String? | FK `Sprint`, `onDelete: SetNull`; set only for `CARRIED_OVER` |

`enum SprintTaskOutcome { DONE  CARRIED_OVER  RETURNED_TO_BACKLOG  REMOVED }`

Indexes: `@@index([tenant_id, sprint_id])`, `@@index([task_id, added_at])`,
and a **partial unique index** in raw SQL in the migration —
`CREATE UNIQUE INDEX sprint_tasks_one_open ON sprint_tasks (task_id) WHERE removed_at IS NULL`
— so a task can never hold two open rows.

**Invariant:** a task's open row, if any, names the same sprint as
`ProjectTask.sprint_id`. Enforced by routing every write through
`SprintMembershipService` (below), checked in tests.

### `SprintBurndownPoint` — replaces `SprintSnapshot`

| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `tenant_id` | String | |
| `sprint_id` | String | FK `Sprint`, `onDelete: Cascade` |
| `recorded_at` | DateTime | |
| `remaining_hours` | Decimal(10,2) | sprint total at that moment |
| `committed_hours` | Decimal(10,2) | sum of estimates |
| `task_count` | Int | |
| `done_task_count` | Int | |
| `cause` | `BurndownCause` | |
| `task_id` | String? | FK `ProjectTask`, `onDelete: SetNull`; null for bulk or sprint-level causes |

`enum BurndownCause { STARTED  WORK_LOGGED  RE_ESTIMATED  TASK_ADDED  TASK_REMOVED  STATUS_CHANGED  COMPLETED  BACKFILLED }`

Index: `@@index([sprint_id, recorded_at])`.

Every point holds **full totals recomputed from the live tasks**, never a
delta. A point that fails to write is corrected by the next one; there is no
drift to accumulate.

`SprintSnapshot` stops being written or read in this release and is dropped
in a follow-up migration once the backfill is verified in production.

---

## Backend

### `SprintMembershipService` (new, `projects/sprint-membership.service.ts`)

The only code that writes `ProjectTask.sprint_id`.

```ts
moveTasks(
  client: Prisma.TransactionClient | DatabaseService,
  tenantId: string,
  taskIds: string[],
  toSprintId: string | null,
  closeAs: SprintTaskOutcome,          // outcome for rows being closed
  opts?: { carriedToSprintId?: string; at?: Date },
): Promise<{ moved: number; leftSprintIds: string[] }>
```

For each task whose current sprint differs from `toSprintId`: close its open
row (`removed_at`, `outcome = closeAs`, `remaining_at_close`), set
`sprint_id`, open a new row if `toSprintId` is non-null. Takes a client so it
runs inside callers that already hold a transaction (the board move at
`project-tasks.service.ts:1018`, project delete, complete).

Call sites converted (every current `sprint_id` write):

| caller | closes as |
|---|---|
| `SprintsService.assignTasks` / `assignStories` | `REMOVED` (leaving another sprint) |
| `SprintsService.removeTasks` | `REMOVED` |
| `SprintsService.complete` | `DONE` / `CARRIED_OVER` / `RETURNED_TO_BACKLOG` |
| `ProjectTasksService.create` (with `sprintId`) | — (opens only) |
| `ProjectTasksService.update` (sprint changed) | `REMOVED` |
| `ProjectTasksService` board move (`:1018`) | `REMOVED` |
| `ProjectTasksService.remove` / `bulkRemove` (soft delete) | `REMOVED` — today these leave `sprint_id` set and rely on `deleted_at` filters; they now clear it and close the row, so the invariant holds for deleted tasks too |
| `ProjectsService.remove` (project delete, `:512`) | `REMOVED` |
| `SprintsService.remove` (sprint delete) | rows cascade with the sprint; tasks' `sprint_id` cleared as today |
| task import, if it ever gains a sprint column | must use `moveTasks` |

**New guards:**
- Assigning to or removing from a `COMPLETED` sprint returns 400. A completed
  sprint's membership is history. (Today nothing server-side stops it; the UI
  just hides the button.)
- `PATCH /sprints/:id` stops accepting `status`. Today it can set `COMPLETED`
  or `ACTIVE` directly, bypassing `complete()` (no history, no carry-over) and
  `start()` (no first point). No frontend caller sends it — the only
  `updateSprint` call is the background picker — so a status in the body now
  returns 400 pointing at `/start` and `/complete`.

### `BurndownRecorder` (replaces `SprintSnapshotService`)

```ts
record(tenantId: string, sprintIds: (string | null | undefined)[],
       cause: BurndownCause, taskId?: string | null): Promise<void>
```

Same contract as today's `refresh`: called **after** the write, never throws
(logs and swallows). Ignores null ids and non-ACTIVE sprints. For each sprint
it recomputes totals (the existing `computeCurrent` query) and inserts a
point — **unless the four figures equal the sprint's latest point**, in which
case it writes nothing (a rename or a description edit must not add noise).
`STARTED` and `COMPLETED` are always written.

Every current `refresh` / `snapshotToday` call site passes a cause:

| site | cause |
|---|---|
| `RemainingHoursService.write` — source `TIME_LOGGED`, `TIME_ENTRY_DELETED` | `WORK_LOGGED` |
| `RemainingHoursService.write` — `RE_ESTIMATED`, `TASK_CREATED` | `RE_ESTIMATED` |
| `RemainingHoursService.write` — `TASK_COMPLETED`, `TASK_REOPENED` | `STATUS_CHANGED` |
| `ProjectTasksService.update`/`move` — status category crosses DONE | `STATUS_CHANGED` |
| any sprint join (create with sprint, update, move, assign) | `TASK_ADDED` on the joined sprint, `TASK_REMOVED` on the left one |
| `removeTasks`, task delete, project delete | `TASK_REMOVED` |
| `start` | `STARTED` |
| `complete` | `COMPLETED` (written before tasks leave, so the final point shows what was left undone) |

`task_id` is set when the call concerns one task; bulk calls store null.

The nightly cron `projects.sprint-snapshots` and its `JOB_NAMES` entry are
removed. `POST /sprints/:id/rebuild-snapshots` (and
`api.rebuildSprintSnapshots`) is removed; the backfill script replaces it.

### Completing a sprint

`POST /sprints/:id/complete` takes an optional body (`CompleteSprintDto`):

```ts
carryTo?:
  | { kind: 'backlog' }
  | { kind: 'sprint'; sprintId: string }
  | { kind: 'new'; name: string; startDate: string; endDate: string; goal?: string; start?: boolean }
```

Omitted means `backlog` — today's behaviour, so existing callers keep working.

Order of operations:

1. `record(sprint, COMPLETED)` — final point with the work still in it.
2. One transaction:
   1. `updateMany({ where: { id, tenant_id, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED' } })`;
      count 0 → **409** "already completed". (Today a second click re-runs the whole thing.)
   2. If `kind: 'new'`: create the sprint (validated like `CreateSprintDto`,
      `endDate >= startDate`). If `kind: 'sprint'`: the target must be in this
      tenant and `PLANNED`, else **400**.
   3. Done tasks: close their rows `DONE`; `sprint_id` stays (unchanged from today).
   4. Unfinished tasks: `moveTasks(tx, …, targetId, CARRIED_OVER, { carriedToSprintId })`,
      or `moveTasks(tx, …, null, RETURNED_TO_BACKLOG)`.
   5. If `start: true`: set the new sprint `ACTIVE` (the old one is already
      COMPLETED, so the one-active-per-tenant rule passes).
3. If the new sprint was started: `record(newSprint, STARTED)`.

Response: the completed sprint plus `{ carried_over: n, carried_to: { id, name } | null }`.

Remaining hours carry unchanged. Time entries and remaining-log rows keep the
sprint they were logged in. Permission: `MANAGE_SPRINTS`, as today.

### Reads

- `GET /sprints/:id/burndown` returns
  `{ sprint, current, ideal: [{ date, value }], points: [{ at, remaining, committed, open, cause, task: { id, code, title } | null }] }`.
  `ideal` keeps today's working-day maths (`buildBurndownSeries`'s ideal
  line). For an ACTIVE sprint the last point is followed by `current` so the
  line reaches "now".
- The sprint page loads its tasks from `GET /project-tasks?sprintId=…`
  (`ProjectTasksService` list, `where.sprint_id = query.sprintId` today). That
  filter becomes **"has a `SprintTask` row in this sprint whose outcome is not
  `REMOVED`"**. For an open sprint that is exactly the tasks whose `sprint_id`
  is it (a task removed mid-sprint has a `REMOVED` row and drops out, as
  today); for a completed sprint it brings back the carried tasks. When the
  filter is present each task also carries `sprintMembership: { outcome,
  remaining_at_close, carried_to: { id, name } | null }` for that sprint. A
  completed sprint's totals use `remaining_at_close`, not the task's live
  hours. The cross-project Tasks page's sprint filter gets the same meaning.
- Task reads (`TASK_INCLUDE` on `findOne`) gain `sprintHistory: [{ sprint: { id, name, status }, added_at, removed_at, outcome }]`,
  oldest first.

---

## Frontend

### Complete dialog — `CompleteSprintModal.tsx` (new, on `ModalShell`)

Opened by **Complete** on `/projects/sprints` (replacing the direct call) and
by a new **Complete** button in the sprint page header (ACTIVE sprints only).

- Summary line: "12 done · 5 unfinished (23h remaining)".
- If anything is unfinished, a radio group "Move the 5 unfinished tasks to":
  - **A new sprint** (default) — name, start date, end date, goal fields.
    Name: the old name with its last number incremented ("Sprint 7" →
    "Sprint 8"); no number → "<name> 2". Start: day after the old end. End:
    start + the old sprint's length. A **Start it now** checkbox, off.
  - **An existing planned sprint** — a `Select` of PLANNED sprints; the
    option is disabled when there are none.
  - **The backlog**.
- Nothing unfinished: no radio group, just confirm.
- Validation inline per field (empty name, end before start); server errors
  through the global toaster. On success: toast, and if the work went to a
  sprint, a link to it.

The name-increment and date defaults live in a pure helper
(`complete-sprint-defaults.ts`) so they are unit-tested without the modal.

### Sprint history on the task card

A read-only **Sprints** fact row beside Milestone: "Sprint 4 → Sprint 5 →
**Sprint 6**", each a link, the current one bold, a past one titled with its
outcome. Shown only when the task has been in more than one sprint, or is in
one now.

### Completed sprint page

Lists tasks from history. A carried task shows a small "→ Sprint 8" badge
linking to where it went; the stats count it as unfinished.

### Burndown chart

`BurndownChart` gains a **time-axis mode**, used only by the sprint page; the
project burndown keeps the daily mode untouched.

- X domain: sprint start 00:00 to end 23:59:59, Dhaka time; day labels and
  gridlines as today.
- **Remaining** and **open tasks** draw as **step lines** — a value holds
  flat until the next point, then steps.
- **Committed** draws as a step line too; it moves only on scope changes.
- **Ideal** as today, with vertices at day boundaries (flat across weekends).
- Markers: only `TASK_ADDED` / `TASK_REMOVED` points get one (hollow), so a
  scope jump reads differently from burned work; no marker per ordinary
  point, so a busy sprint stays legible.
- Hover anywhere over the plot shows the nearest point: time, remaining,
  open, cause label, and the task's code + title when there is one. Touch:
  tap to show, tap elsewhere to hide.

### Strings

New labels (dialog, outcomes, causes, Sprints fact, carried badge) in all
nine locale catalogues; `catalog.test.ts` enforces parity.

---

## Backfill (`packages/database/prisma/backfill-sprint-history.ts`)

Report-only unless `--apply`, idempotent (skips sprints that already have
rows/points), like `backfill-task-remaining.ts`. Procedure added to
`docs/ops/deployment-runbook.md` → One-off Data Backfills.

**History rows.**
- Every task with `sprint_id` set on a PLANNED/ACTIVE sprint: one open row,
  `added_at` = its earliest remaining-log row in that sprint, else the
  sprint's `start_date`.
- For each COMPLETED sprint, every `(task, sprint)` pair seen in
  `ProjectTaskRemainingLog` or currently in `sprint_id`: one closed row.
  Outcome `DONE` if the task still points at the sprint, else
  `RETURNED_TO_BACKLOG` (what `complete()` did). `removed_at` = the sprint's
  end date, 23:59 Dhaka. `remaining_at_close` = the task's last log value in
  that sprint.
- **Known gap:** a task carried out of a completed sprint that never had a
  remaining-log row (no estimate, no time) cannot be recovered. It
  contributed zero hours, so the burndown is unaffected; it is only missing
  from that sprint's list.

**Points.** For each ACTIVE or COMPLETED sprint, replay its remaining-log rows
in time order, emitting one point per row with the running total (per task,
latest value) and the cause mapped as in the recorder table. Days covered by a
`SprintSnapshot` but by no log row get one `BACKFILLED` point at 23:50 Dhaka
from the snapshot's figures. `committed_hours` on replayed points comes from
the latest snapshot on or before that day; open counts are inferred from
remaining reaching zero, the same limitation `computeFromLog` documents today.

---

## Testing

**Backend (Jest, mocked `DatabaseService` as in the existing specs):**
- `SprintMembershipService.moveTasks`: opens/closes rows, one open row per
  task, no-op when the task is already in the target, works on a tx client.
- `complete`: each of the three `carryTo` kinds; omitted body = backlog; Done
  tasks stay and close `DONE`; second call → 409; non-PLANNED target → 400;
  `start: true` activates the new sprint.
- Assign/remove on a COMPLETED sprint → 400.
- `BurndownRecorder.record`: writes full recomputed totals; skips an
  identical point; always writes STARTED/COMPLETED; ignores PLANNED sprints;
  never throws.
- Each converted call site passes the right cause (spot-checked in the
  existing service specs).
- `GET /project-tasks?sprintId=` on a completed sprint returns carried tasks
  with their membership; on an open sprint it excludes a task removed mid-sprint.
- `PATCH /sprints/:id` with `status` → 400.

**Backfill:** run against a scratch Postgres loaded from a dump; a completed
sprint gets its carried tasks back, points line up with the old snapshots on
the days both exist, a second run changes nothing.

**Frontend (Vitest):** `complete-sprint-defaults` (name increment, dates);
the modal's three choices and disabled planned-sprint option; the task card
Sprints row; chart step-path generation and nearest-point hover.

---

## Rollout

One migration (`sprint_tasks`, `sprint_burndown_points`, two enums, the
partial unique index). Deploy, run the backfill report, then `--apply`.
`SprintSnapshot` is dropped by a later migration after the backfilled charts
are checked in production.
