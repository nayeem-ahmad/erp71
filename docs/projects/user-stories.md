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
| `status` | `BACKLOG → READY → IN_PROGRESS → DONE`, set by hand. |
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

`status` is deliberately **not** derived from those counts. It is the grooming
state somebody sets by hand: a story whose tasks are all done is still not
accepted until a person says so, which is the entire point of acceptance
criteria.

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

## UI

Everything is on the project page (`/projects/[id]`), above the flat task table:
the stories are what the tasks are *for*, and the table below is the same work
seen flat.

- A collapsed story row shows `US-3`, its title, its points, `1/4 tasks` and its
  status. The counts are in the **collapsed** row on purpose: a collapse that
  cannot say whether it holds anything is one people open to check.
- Opening a row composes the "As a … I want … so that …" sentence, shows the
  acceptance criteria, lists the tasks under the story, and offers a one-field
  quick add that files a new task straight under it. The tasks are fetched per
  story on open — a backlog of forty would otherwise pull the project's whole
  task table to draw rows nobody expands.
- A task opened from a story row opens the page's existing `TaskDetailPanel`,
  not a second one.
- `TaskDetailPanel` has a **User story** picker beside the assignee, loaded the
  first time it is touched (the card already knows which story holds it, so the
  field reads correctly before the list arrives).
- The new-task dialog on the project page offers the picker only where the
  project actually has stories.

Nothing was added to the sidebar. A story belongs to one project, and a
cross-project backlog page would be a second place to look for the same rows.

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
