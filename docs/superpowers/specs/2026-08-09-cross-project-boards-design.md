# Cross-project Boards — design

Date: 2026-08-09
Status: approved, ready for planning

## Problem

A board today is not a thing — it is a view of exactly one project, at
`/projects/[id]/board`, rendering that project's tasks in that project's
`ProjectTaskStatus` columns. Work that spans projects has nowhere to live: a
release, a support rotation, or one team's queue across three projects cannot be
seen on a single wall.

Two changes follow from that:

1. **Boards becomes its own submenu** under Project Management, listing boards
   as first-class objects.
2. **A board holds tasks from any number of projects.** Boards and projects are
   independent concepts — there is no such thing as "the project's board".

## Decisions

These were settled during brainstorming and are not open in planning.

| Question | Decision |
|---|---|
| What is a Board? | A container that owns its own columns. Each board column maps to one or more existing `ProjectTaskStatus` rows; a drop writes the task's real project status through that mapping. |
| How do tasks join a board? | Explicit membership only. A user picks tasks and adds them. Nothing joins a board by rule. |
| Is there a per-project board? | No. The concept is removed; `/projects/[id]/board` is deleted. |
| How are columns mapped? | Auto-bound on first contact with a project — by column name, falling back to status category — with manual override in board settings. |
| Who can see a board? | Every user in the tenant holding the projects permission. Boards have no member list. |

`ProjectTask.status_id` remains the single source of truth for a task's status.
Joining a board changes nothing about a task.

## Data model

Four new models in `packages/database/prisma/schema.prisma`, placed beside the
existing project models. All are tenant-scoped and reached through
`TenantInterceptor` like every other business table.

### `Board`

```prisma
id           String    @id @default(uuid())
tenant_id    String
name         String
description  String?
created_by   String?
created_at   DateTime  @default(now())
updated_at   DateTime  @updatedAt
deleted_at   DateTime?

@@index([tenant_id, deleted_at])
@@map("boards")
```

Soft-deleted, matching `Project` and `ProjectTask`. Names are deliberately not
unique: a unique `(tenant_id, name)` would let a soft-deleted board hold its name
hostage against a new one, and two boards called "Q3" is a user's problem, not a
data-integrity one.

### `BoardColumn`

```prisma
id         String                    @id @default(uuid())
tenant_id  String
board_id   String
name       String
category   ProjectTaskStatusCategory @default(TODO)
sort_order Int                       @default(0)
wip_limit  Int?

@@unique([board_id, name])
@@index([board_id, sort_order])
@@map("board_columns")
```

`category` is reused rather than redefined: it is what the name-match fallback
keys on, and it lets a board column declare its intent (a `DONE` column completes
its cards) without a second enum meaning the same three things.

`wip_limit` carries the same advisory semantics as `ProjectTaskStatus.wip_limit`
— the board marks a column over-limit, it does not refuse the drop.

### `BoardColumnStatus`

The mapping table. One row binds one project status to one column of one board.

```prisma
id              String @id @default(uuid())
tenant_id       String
board_id        String
board_column_id String
status_id       String

@@unique([board_id, status_id])
@@index([board_column_id])
@@map("board_column_statuses")
```

`board_id` is denormalised here for exactly one reason: it carries the
`@@unique([board_id, status_id])` constraint, which is what guarantees a status
resolves to at most one column and therefore that a card never appears twice on
the same board. Deriving `board_id` through `board_column_id` would lose that.

Deleting a `BoardColumn` cascades its bindings; the affected cards fall to
Unsorted (below) rather than disappearing.

### `BoardTask`

```prisma
id         String   @id @default(uuid())
tenant_id  String
board_id   String
task_id    String
sort_order Int      @default(0)
added_by   String?
added_at   DateTime @default(now())

@@unique([board_id, task_id])
@@index([board_id, sort_order])
@@map("board_tasks")
```

Hard-deleted on removal — taking a card off a board is not an event worth
keeping. A soft-deleted `ProjectTask` is filtered out of board reads rather than
having its `BoardTask` row cleaned up.

## Auto-binding

Binding happens per `(board, project)` pair, once, and covers the project's
entire status set — not just the status the incoming task happens to be in.
Binding the whole set up front is what makes later drags and out-of-band status
changes (from the task detail panel, from a sprint action) land in the right
column instead of dropping the card to Unsorted.

**On board creation**, columns are seeded from the tenant status template — the
`ProjectTaskStatus` rows with `project_id = null` — copying `name`, `category`
and `sort_order`. A board therefore opens with the columns the tenant already
thinks in.

**When a task from a project not yet seen on this board is added**, for each
`ProjectTaskStatus` belonging to that project, in `sort_order`:

1. Bind to the board column whose `name` matches case-insensitively after
   trimming.
2. Otherwise bind to the lowest-`sort_order` board column with the same
   `category`.
3. Otherwise leave unbound.

A status already bound on this board is skipped — step 1 and 2 never overwrite an
existing binding, so a manual override survives later task additions.

Board settings expose every binding for manual correction, grouped by project.

## Card placement and drag

A card renders in the column bound to its task's `status_id`.

**Unsorted.** A card whose status has no binding renders in a leading, synthetic
`Unsorted` column. It is not a `BoardColumn` row and is not persisted; it appears
only when it has cards, labelled so the cause is obvious, with a link to board
settings. The rejected alternative was hiding such cards, which loses work
silently — a visibly wrong column is better than a card that vanished.

**Dropping onto a column** sets `task.status_id` to that column's binding *for
that card's own project*. Where a column binds several of one project's statuses,
the lowest `ProjectTaskStatus.sort_order` wins. The write goes through the
existing status-change path in `project-tasks.service.ts` so `completed_at`,
`ProjectTaskActivity` rows and remaining-hours behaviour stay identical to a
status change made anywhere else.

**Dropping onto a column with no binding for that project** is refused: the card
returns to its origin and an inline message names the project and points at board
settings. This is the only drop that can fail.

**Reordering within a column** writes `BoardTask.sort_order` and touches nothing
on the task.

Cards carry a project chip rendering `Project.short_name ?? Project.code` — the
field added for exactly this purpose — since a card's project is no longer implied
by the page.

## Backend

New files in the existing `apps/backend/src/projects/`, registered in
`ProjectsModule`:

- `boards.controller.ts` — routes
- `boards.service.ts` — board CRUD, membership, card moves
- `board-columns.service.ts` — column CRUD, seeding, auto-binding, manual bindings

Splitting columns/binding away from `boards.service.ts` keeps each file to one
job; `ProjectsModule` already follows this pattern with its settings, comments,
attachments and time services.

### Routes

All under `/projects/boards`, guarded by `JwtAuthGuard, StorePermissionGuard`:

| Method | Path | Permission |
|---|---|---|
| GET | `/projects/boards` | `VIEW_PROJECTS` |
| POST | `/projects/boards` | `MANAGE_PROJECTS` |
| GET | `/projects/boards/:id` | `VIEW_PROJECTS` |
| PATCH | `/projects/boards/:id` | `MANAGE_PROJECTS` |
| DELETE | `/projects/boards/:id` | `MANAGE_PROJECTS` |
| POST | `/projects/boards/:id/tasks` | `MANAGE_PROJECTS` |
| DELETE | `/projects/boards/:id/tasks/:taskId` | `MANAGE_PROJECTS` |
| PATCH | `/projects/boards/:id/tasks/:taskId/move` | `MANAGE_PROJECTS` |
| POST | `/projects/boards/:id/columns` | `MANAGE_PROJECT_SETTINGS` |
| PATCH | `/projects/boards/:id/columns/:columnId` | `MANAGE_PROJECT_SETTINGS` |
| DELETE | `/projects/boards/:id/columns/:columnId` | `MANAGE_PROJECT_SETTINGS` |
| PUT | `/projects/boards/:id/columns/:columnId/statuses` | `MANAGE_PROJECT_SETTINGS` |

No new permission keys. Reads take `VIEW_PROJECTS`, board and card mutations take
`MANAGE_PROJECTS`, column and binding configuration takes
`MANAGE_PROJECT_SETTINGS` — the same three the projects controller already uses,
which is what tenant-wide access means here.

`POST /projects/boards/:id/tasks` accepts an array of task ids so adding a
selection is one request, and runs auto-binding for any project appearing on the
board for the first time.

`GET /projects/boards/:id` returns the board, its columns with bindings, and its
cards with the fields the board renders — title, priority, assignee, due date,
labels, cover colour, project name/short name — in one response, as the current
project board page already does.

## Frontend

| Route | Content |
|---|---|
| `/projects/boards` | Board list. `PageShell` + `PageHeader`, create via `ModalShell`. |
| `/projects/boards/[id]` | The board. Adapted from the current `/projects/[id]/board` page. |
| `/projects/boards/[id]/columns` | Column configuration plus per-project binding rows. Adapted from the current `/projects/[id]/columns` page. |

The existing board page is ~878 lines and carries the drag interaction, card
rendering and column layout that the new board needs unchanged; it is the
starting point rather than a reference. `board-tasks.ts` and `board-drag.ts` are
already unit-tested helpers and are reused as-is.

New: an **Add tasks** modal — searches tasks across every project the user can
see, filterable by project, multi-select, submitting one `POST .../tasks`.

Nav registration in `packages/shared-types/navigation.ts`:

```prisma
'projects.boards': { id: 'projects.boards', kind: 'link', icon: 'KanbanSquare',
                     labelKey: 'sidebar.items.projectsBoards', href: '/projects/boards' }
```

with `layoutNode('projects.boards', 'projects', 1)` and Tasks, Sprints and Setup
shifted to 2, 3 and 4. Label `projectsBoards` = "Boards" added to the `sidebar.items`
block of `en`, `bn` and `ms`.

All new UI follows the standing rules: `PageShell`/`PageHeader`, `ModalShell`,
`@/components/ui` primitives, `blue-600` as the only accent, compact density,
global `Toaster`, ≥44px touch targets, no horizontal body scroll at 360px.

## Removed

- `apps/frontend/src/app/(app)/projects/[id]/board/page.tsx` and its
  `page.test.tsx`
- The Board link on the project detail page

`/projects/[id]/columns` **stays**. Projects still own their `ProjectTaskStatus`
rows — those are what board columns bind to — so editing a project's own statuses
remains a real job. The new board settings page is adapted from it, not a
replacement for it.

## Testing

**Backend** (`*.spec.ts` beside each service):

- Auto-binding: exact name match; case/whitespace-insensitive match; category
  fallback when no name matches; left unbound when neither hits; an existing
  binding is never overwritten by a later task addition.
- A status cannot bind to two columns of one board.
- A drop resolves to the correct status for each of two projects on the same
  board, and to the lowest `sort_order` status when a column binds several.
- A drop onto a column unbound for that project is rejected, and the task's
  status is unchanged.
- A drop into a `DONE` column sets `completed_at` and writes a
  `ProjectTaskActivity` row.
- Every read and write is scoped by `tenant_id`; a board from another tenant is
  invisible and unmodifiable.
- Soft-deleted tasks do not appear in board reads.

**Frontend**:

- Board page groups cards by column and shows a project chip per card.
- Unsorted column appears only when a card is unbound.
- Drag calls the move endpoint with the target column and sort order.
- Rejected drop restores the card and shows the message.
- Add-tasks modal searches across projects and submits a multi-select.

## Migration

Additive only: four new tables, no column drops or renames, no backfill. Applied
as direct SQL against the local database plus `prisma generate`, since this
repo's local database has no `_prisma_migrations` history and `prisma migrate dev`
fails against it. A migration file is still committed for production.

Removing the old board route is code-only and touches no data.
