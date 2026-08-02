# Project Management — Phase 3: Trello-style task cards

**Status:** proposed, not started
**Written:** 2026-08-02
**Predecessors:** `project-management-phase-1.md`, `project-management-phase-2.md`

The ask: *"Project Management board — task cards should have Trello-like
features."*

This document is the list and the plan. It is grounded in what the module
actually contains today, not in a generic Trello feature dump — a surprising
amount of the answer is already in the database and simply has no UI.

---

## Where the board is today

`/projects/[id]/board` renders one column per tenant `ProjectTaskStatus` and one
card per `ProjectTask`. Drag-and-drop works (HTML5 DnD, optimistic move,
rollback on failure), there is a kanban/scrum toggle, and scrum mode draws the
sprint burndown above the columns.

**A card renders exactly three things: the title, a remaining-hours badge, and
the assignee's name.**

That is the whole card. Which is worth stating plainly next to what
`ProjectTask` already carries and what the board endpoint already returns:

| Already on the model / in `TASK_INCLUDE` | On the card? |
|---|---|
| `due_date` | no |
| `priority` (LOW/MEDIUM/HIGH/URGENT) | no — the board's TS interface has the field and never renders it |
| `checklistItems` (fully included, ordered) | no |
| `_count.comments` | no |
| `_count.subtasks` | no |
| `milestone`, `sprint` | no |
| `description` | no |
| `estimate_hours`, `logged_hours` | no |
| `completed_at` | no |

So the board fetches a rich task and draws a sticky note.

### Three specific findings

1. **Board cards are not clickable.** `TaskDetailPanel` exists and is wired into
   `/projects/tasks` and `/projects/[id]`, but `board/page.tsx` neither imports
   it nor puts an `onClick` on the card. On the board — the surface where a
   Trello user expects to *live* — there is no way to open a task at all.

2. **Checklists are built and invisible.** The full stack exists:
   `ProjectTaskChecklistItem`, `POST /project-tasks/:id/checklist`, `PATCH` and
   `DELETE /project-tasks/checklist/:itemId`, service methods with tenant
   scoping, and even the three api-client methods
   (`addTaskChecklistItem`/`updateTaskChecklistItem`/`deleteTaskChecklistItem`).
   No component in the codebase calls any of them.

3. **The board is read-only on a phone.** HTML5 `draggable` does not produce
   drag events from touch input on iOS Safari or Android Chrome. A phone user
   can see the board and cannot move a card on it. Given this project's mobile
   rules, that is a defect and not a gap.

Also worth naming while we are here: `ProjectComment` is a model with a
`CreateCommentDto` written for it and **no controller and no service** — dead
code since Phase 1 — and `ProjectAttachment` has a model and no API at all.

---

## The list

Grouped by what it costs, not by how it reads on a feature grid.

### Tier 1 — already in the database, needs only UI

The cheapest and, per unit of work, by far the most visible.

- **3A · Open the card, and make the card say something.** Click a card → the
  existing `TaskDetailPanel`. Add badges the endpoint already returns: due date
  (with overdue / due-soon / done states, driven by `completed_at`), priority,
  checklist progress `3/7`, comment count, subtask count, description-present
  marker, assignee avatar instead of a wrapped name. Nothing new server-side.
- **3B · Checklist UI** in the detail panel — add, tick, rename, reorder,
  delete, with a progress bar. Purely a component over endpoints that exist.
- **3C · Comments.** `ProjectComment` is modelled and `_count.comments` is
  already selected. Needs a small service + controller (list/create/edit own/
  delete own) and a thread in the panel. `@mentions` explicitly deferred to 3I,
  where there is something to notify.
- **3D · Attachments.** Model exists, API does not. **This one carries a known
  trap:** `TODO.md` records that `ProjectAttachment` stores only `file_url`,
  which cannot be turned back into a Cloudinary `public_id`, so attachments can
  never be deleted from storage and leak cost forever. Building the upload path
  now means building it on `uploadBuffer()` + a `storage_key` column — which is
  the fix for that bug, not extra scope. Doing it the old way would deepen a
  liability we have already written down.
- **3E · Subtasks on the card.** `parent_task_id` exists, `findOne` already
  returns subtasks with their statuses, nothing displays them. Show them in the
  panel with inline add and a done-count badge on the card.

### Tier 2 — new schema, and the part people mean by "Trello"

- **3F · Labels.** The single most-used Trello feature we do not have.
  `ProjectLabel` (tenant-scoped: name + colour chosen from a fixed palette, not
  a free hex field — the UI rules forbid arbitrary hex) plus a
  `ProjectTaskLabel` join. Colour chips on the card, a label filter on the
  board, management under project settings alongside task statuses.
- **3G · Card members (plural).** Today a task goes to one user *or* one
  employee. Trello lets several people sit on a card. See the open question
  below — this is the decision I would not take alone.
- **3H · Dates.** Add `start_date` to pair with `due_date`, and render a real
  date chip that changes tone on overdue. Trello's "mark due date complete" maps
  onto `completed_at`, which already exists and is already maintained by
  `move()`.
- **3I · Watchers + activity feed.** A `ProjectTaskActivity` append-only table
  (created, moved, assigned, renamed, re-estimated, commented) and a
  `ProjectTaskWatcher` join. This is what makes a card a conversation rather
  than a record, and it is the prerequisite for any notification work — there is
  currently no way to find out that something you care about changed.
- **3J · Archive.** `deleted_at` soft-deletes, but nothing can un-delete and no
  screen lists archived tasks. Trello's archive is reversible and users assume
  it. Small work, and it also makes the existing soft-delete honest.
- **3K · Cover colour on the card.** Cosmetic, cheap, lowest value on this list.
  Listed for completeness; it should go last.

### Tier 3 — board-level, not card-level

Not literally "task card features", but nobody who says "make it like Trello"
means a board without these.

- **3L · Per-project columns and WIP limits.** The architectural fork — see the
  open question below.
- **3M · Add a card from the board.** "+ Add a card" at the foot of a column
  with an inline title field. Today, creating a task means leaving the board
  entirely, which is the interaction Trello is most known for.
- **3N · Board filters and touch drag.** Filter by assignee / label / due /
  priority, and replace the HTML5 DnD with a pointer-event implementation so a
  phone can move a card. Finding 3 above is fixed here.

---

## Two decisions I would want taken before building

Phase 2 was scoped by taking its open question up front rather than discovering
it mid-build. Same shape here.

### 1. Are board columns tenant-wide or per-project?

`ProjectTaskStatus` is `@@unique([tenant_id, name])` with **no `project_id`** —
every project in the tenant shares one set of columns. A Trello list belongs to
exactly one board, so the literal translation is per-project columns.

I would not do the literal translation. Tenant-wide statuses are load-bearing:
Phase 2 deliberately made sprints tenant-level and the Tasks page filters by
`statusCategory` across every project. Per-project columns would fragment that
vocabulary and break the cross-project views we just built.

**Recommendation — the middle path:** keep `ProjectTaskStatus` as the shared
vocabulary and add an opt-in `ProjectBoardColumn(project_id, status_id,
sort_order, wip_limit, is_hidden)`. A project that configures nothing sees every
status in tenant order, exactly as today: no data migration, no behaviour change
for existing tenants, and every cross-project query untouched. A project that
wants five columns and a WIP limit of 3 on *In Progress* gets it.

### 2. One assignee, or many members per card?

`ProjectTask` carries `assignee_id` **xor** `assignee_employee_id` — the pair
Phase 2 added so an employee without a login can hold work. Going plural sounds
like adding a join table; it is not. That single field is read by remaining-hours
attribution, the burndown, the Tasks page's default "assigned to me" filter,
`assigneeOf()`, and every "who is this for" query in the module.

**Recommendation:** keep the existing assignee as the *owner* — the one
accountable person that reporting reads — and add `ProjectTaskMember` for
additional collaborators shown as avatars on the card. This is how most ERP
boards behave and it costs one table. Making assignment genuinely plural is a
phase of its own, and it would force a decision about whose burndown a shared
task belongs to, which nobody has asked for.

---

## Risks and things easy to under-estimate

- **`move()` rewrites the whole column.** Every drag re-numbers every sibling
  one `UPDATE` at a time inside a transaction. Fine at 20 cards, not fine at 200,
  and two people dragging in the same column will contend. Tier 3 adds filters
  and inline creation, which makes columns longer. Either batch the renumber or
  move to fractional ordering — worth doing while touching this code, and not
  worth a phase on its own.
- **`useServerList` swallows failures into an empty table.** Still open in
  `TODO.md`, still unread by every call site, and it has already disguised two
  bugs in *this* module as "there's nothing there". Any new list in this phase
  inherits it.
- **i18n.** Every label lands in en, bn and ms. Catalog parity is enforced at
  build time — a missed key fails, it does not degrade. This phase is
  label-heavy; budget for it.
- **Permissions.** `MANAGE_PROJECT_TASKS` covers the card edits. Comments
  probably want a lighter gate — a viewer should arguably be able to comment
  without being able to move cards — which is a new permission if we want it.
- **Attachments = upload surface.** 3D introduces tenant-supplied files into a
  module that has none today: type allow-list, size cap, and the `storage_key`
  work above.

---

## Suggested sequencing

| Order | Item | Why here |
|---|---|---|
| 1 | 3A | Cards open and say something. Hours of work; changes how the board *feels* more than anything else on this list. Ship it alone. |
| 2 | 3B + 3E | Pure UI over finished endpoints. No schema, no risk. |
| 3 | 3M + 3N | Board becomes usable — create without leaving, filter, and work on a phone. |
| 4 | 3F + 3H | First schema change; do labels and dates in one migration. |
| 5 | 3C + 3I | Comments and activity together — the same panel, and activity is what makes comments findable. |
| 6 | 3G + 3L | Both gated on the decisions above. |
| 7 | 3D | Last: it needs the `storage_key` fix, so it is the only item with a prerequisite outside this phase. |
| 8 | 3J + 3K | Archive, then cover colour. |

**If only one thing ships: item 1.** A board whose cards cannot be opened and
show three fields is the gap between what we have and "like Trello" far more
than labels or covers are.
