# Project Management — user stories

**Written:** 2026-09-13
**Predecessors:** `project-management-phase-1.md`, `project-visibility.md`, `project-record-scope.md`

The ask: *"In project management, add option for user stories for projects. Task
can be child of a user story."*

A project could already say **what is being done** — tasks on a board, grouped by
milestone, sized in hours. It could not say **what is being asked for**. This
adds that: a user story is the requirement in the words of whoever wants it, and
every task can be filed under one.

---

## The model

```
Project ─┬─ ProjectMilestone ── a date the project is measured against
         ├─ ProjectUserStory ── a piece of scope, "US-3"
         └─ ProjectTask ──────── the work
                ├─ milestone_id    (optional)
                ├─ user_story_id   (optional)   ← new
                └─ parent_task_id  (optional)
```

A task may carry one, both, or neither. The three are independent axes and a
task is never required to have any of them.

### Why not `parent_task_id`

A subtask is a smaller piece of *the same work*: it shares its parent's board
column, its assignee, its hours. A story is a *requirement* — several tasks
across several columns deliver it, and it is finished only when the thing it
describes actually works.

Folding the two together would have meant a story that sits in a board column
and burns hours of its own. Every hour in this module belongs to a task
(`ProjectTimeEntry.task_id` is not nullable), and `progress()` and both burndowns
count tasks; a "task" that were really a story would be counted twice — once as
the container and once as its contents. So the story is a second column on the
task, not a second kind of task.

`ProjectTask.parent_task_id` keeps its one-level rule and is untouched: a subtask
can belong to a story like any other task, and it inherits nothing — the column
is set, or it is not.

### Why it sits beside milestones rather than replacing them

A milestone is a **date** ("first fitting, 12 Oct"); a story is a **piece of
scope** ("shopper can pay with bKash"). A shop doing a kitchen fit-out wants
milestones and no stories; a team building software wants the reverse. Both
exist, neither is mandatory.

### Fields

| Column | Why |
|---|---|
| `reference` | Per-project counter, rendered `US-3`. A story is the thing named out loud in a standup, and "the bKash one" does not survive a backlog of forty. |
| `title` | The one required field. |
| `as_a`, `i_want`, `so_that` | The classic template as three columns, not one blob: the card composes the sentence in the reader's own language, and a story missing its *why* is visibly missing it. All optional — refusing to save a one-line story would push people back to writing tasks. |
| `acceptance_criteria` | What "done" means, as free text. A task's checklist already covers tick-off work; acceptance criteria are read whole. |
| `status` | `BACKLOG → READY → IN_PROGRESS → DONE`. Follows the story's tasks once it has any; only Backlog ↔ Ready is set by hand (see below). |
| `priority` | The same `ProjectPriority` as everything else in the module. |
| `story_points` | Relative size, **never hours**. Hours live on the tasks and roll up from them; a story carrying both would invite the two to disagree. |
| `sort_order` | Backlog order. New stories land at the bottom. |

`reference` continues from the highest existing number rather than from a count,
so deleting US-2 does not hand its number to the next story written — two
different stories called US-2 would make every older note about it wrong. Two
concurrent creates are settled by retrying on the unique violation, the same way
`ProjectsService.nextCode` allocates `PRJ-0001`.

---

## Progress is counted, never stored

A story's `progress` (`taskCount`, `doneTaskCount`, `percentComplete`) is
counted from its tasks on every read, for the reason `ProjectsService.progress`
gives: a stored copy drifts the moment a card moves and nobody recalculates it.
The whole list is counted in **one** query — Prisma cannot `groupBy` a relation's
field, so the rows are folded in memory rather than counted per story, which
would be an N+1 growing with the backlog.

**Revised 2026-09-25: `status` follows the story's tasks.** It was first set
by hand, on the grounds that finished tasks are not an accepted story; in use,
a hand-set status just drifted from the work, and the Backlog tree made the
drift visible on every row. The rule now (`story-status.util.ts`):

| Tasks | Status |
|---|---|
| none | whatever was set — nothing to derive from |
| all TODO | the grooming state, BACKLOG or READY; a story that had moved on falls back to READY |
| any started, or some done | IN_PROGRESS |
| all DONE | DONE |

It is still stored, so the list can filter on it. `syncStoryStatuses` rewrites
it after every task create, update, move, delete and bulk delete, and after a
board column is recategorised; opening a project's Backlog also re-syncs that
project's stories, which repairs anything written before the rule existed. A
hand-set status the tasks contradict is refused with a 400.

---

## Access

Stories inherit the project's visibility like everything else hanging off a
project (`project-visibility.md`): a story on a `PRIVATE` project is reported
**missing**, not forbidden, to anyone who cannot open the project itself.

Task counts go through the same `taskFilter` as the task list, so a viewer
narrowed to their own records (`project-record-scope.md`) never sees a count
covering rows the list would not show them.

| Action | Permission |
|---|---|
| Read stories | `VIEW_PROJECTS` |
| Create / edit / delete a story | `MANAGE_PROJECTS` |
| File a task under a story | `MANAGE_PROJECT_TASKS` (it is a task edit) |

Writing a story takes `MANAGE_PROJECTS` — the permission milestones already
take — because a story is scope the project is committing to rather than a card
on a board. Moving an existing task in or out of a story is an ordinary task
edit and needs no more than editing the task did.

---

## API

| Route | Permission | Notes |
|---|---|---|
| `GET /project-stories?projectId=&status=&search=` | VIEW_PROJECTS | `projectId` optional; omitted returns every story the caller can reach. Each row carries `progress`. |
| `GET /project-stories/:id` | VIEW_PROJECTS | The story plus the tasks under it. |
| `POST /project-stories` | MANAGE_PROJECTS | `projectId` + `title` required. |
| `PATCH /project-stories/:id` | MANAGE_PROJECTS | Cannot move a story between projects — its tasks would be left behind. |
| `DELETE /project-stories/:id` | MANAGE_PROJECTS | **Detaches** its tasks; never deletes work. |

On the task side, `userStoryId` is accepted by `POST /project-tasks` and
`PATCH /project-tasks/:id` (`''` clears it, the spelling every other optional
relation in `project.dto.ts` uses), and `GET /project-tasks` takes
`userStoryId=` and `noUserStory=true` — the latter being what backlog grooming
has not yet reached.

A story from another project is refused with a 400 rather than silently ignored:
a card filed under another project's story would be counted into a backlog
nobody looking at this board can see.

Deleting a story detaches its tasks in the same transaction, the call
`removeMilestone` already makes for the same reason — the story was a grouping,
the tasks are the work, and the hours logged against them are a record of an
afternoon somebody actually spent. `ON DELETE SET NULL` on the foreign key is
the backstop.

---

## UI — the Backlog tree (rebuilt 2026-09-25/26)

Epics, stories and tasks are edited in one place: the **Backlog**, a single
ARIA tree of epic → story → task. It is the same component
(`components/projects/backlog/BacklogWorkspace.tsx`) on three screens:

| Screen | What it shows |
|---|---|
| `/projects/[id]/backlog` | One project, opened to the stories, including "Tasks without a story" |
| `/projects/stories` | Every project with scope, grouped by project, opened to the stories |
| `/projects/epics` | The same, folded to the epics |

The project page no longer carries epic and story cards; it shows a
`BacklogSummary` (epics, stories and points done) with a link in, and forwards
the old `/projects/<id>?story=` / `?epic=` links to the Backlog.

**Reading it.** Every parent row carries its rollup — stories done and points
for an epic, tasks done and a bar for a story, hours and assignee for a task —
counted from every row *before* filtering, so hiding done work never misstates
progress. Orphans are kept visible under "No epic" and "Tasks without a story".
Search keeps a hit's ancestors; the fold state is remembered per screen.
Subtasks are left out: they belong to their task's own panel.

**Rearranging.** Three routes, one write path: drag a row by its handle (mouse,
or long-press on touch), pick a new parent from the row's "Move to" chip, or
Alt+↑/↓ on the focused row. Each becomes a `BacklogMove`; `resolveDrop` in
`backlog-rows.ts` decides which drops are legal (never across projects, never a
task under an epic). The page applies the move at once and sends the target
group's **whole** order — `PATCH /project-backlog/:projectId/scope/order` for
epics and stories, `…/tasks/order` for tasks — then reloads so derived story
statuses catch up. A task's backlog position is `ProjectTask.backlog_order`,
deliberately separate from its board-column `sort_order`.

**Editing in place.** Status, priority, points and assignee are chips on the
row. A story's status chip only offers Backlog/Ready while its tasks are
untouched and disappears once work has started, because the status then
follows the tasks.

**Many at once.** Row checkboxes (Space from the keyboard, Shift to extend)
open a bar with priority, status, "Move to", assignee and delete.
`POST …/scope/bulk` and `…/tasks/bulk` apply the action row by row through the
existing story, epic and task services, so a bulk change behaves exactly like
single ones; rows the server refuses come back with a reason instead of failing
the batch.

**Keyboard.** ↑/↓ between rows, → opens (or steps in), ← closes (or steps out
to the parent), Home/End, Enter opens the editor, Space selects. The tree is
one tab stop.

## Epics (added 2026-09-24)

An epic is the parent of stories: **epic → story → task**. It follows the same
rules as a story, one level up:

- **Per project.** `ProjectEpic.project_id`, with visibility inherited from the
  project. A story can only join an epic in its own project
  (`ProjectUserStory.epic_id`, checked in `ProjectStoriesService`).
- **An ID people can say.** `reference` is the internal counter; `code` is
  editable and defaults to `<project.code>-E<n>` (`OTB-E2`), so it can never be
  confused with story `OTB-2`.
- **No work of its own.** Progress is counted on every read: stories done out of
  stories (the headline percentage), points done out of points, and the tasks
  under those stories (through `taskFilter`, so a narrow viewer's counts match
  their task list). Nothing is stored that could drift.
- **Status is set by hand** — OPEN, IN_PROGRESS, DONE, CANCELLED. An epic whose
  stories are all accepted may still be open because more scope is coming;
  CANCELLED keeps dropped scope on record without deleting its stories.
- **Deleting an epic detaches its stories**, exactly as deleting a story
  detaches its tasks.

Surfaces: the Epics card above the stories card on the project page (expand to
see the stories, quick-add a story into the epic, `?epic=<id>` opens one), the
cross-project list at `/projects/epics` (filters, New, Import), an Epic picker in
the story form, an epic chip on story rows, and an Epic column and filter on
`/projects/stories`. The story import accepts an `epic` column (ID or title,
within the row's project).
