# Project Management — Phase 3: Trello-style task cards

**Status:** 3A and 3B shipped 2026-08-03; the rest scoped and sequenced below
**Written:** 2026-08-02 · **Decisions taken:** 2026-08-03
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

## Decisions taken — 2026-08-03

Phase 2 was scoped by taking its open question up front rather than discovering
it mid-build. Same shape here, and both were answered before any code landed.

### 1. Board columns are per project — DECIDED

`ProjectTaskStatus` is `@@unique([tenant_id, name])` with **no `project_id`**,
so every project in the tenant currently shares one set of columns. A Trello
list belongs to exactly one board, and that is the behaviour we want: a board's
columns are the board's.

I had recommended keeping the tenant-wide list and layering a per-project
overlay on top; the call went to genuine per-project columns instead, so 3L is
the literal translation.

**The one constraint that must survive.** Phase 2 deliberately made sprints
tenant-level, and the Tasks page filters across every project by
`statusCategory` rather than by column identity — that is what lets "open tasks"
be one parameter instead of an enumeration of a tenant's columns. Per-project
columns are therefore fine **as long as every column still carries a
TODO/IN_PROGRESS/DONE category**, and every cross-project rollup keys on the
category rather than on a shared status row. Any 3L implementation that drops
the category, or lets a project define a column without one, breaks the
tenant-wide sprint board and the Tasks page together.

Migration shape when 3L is built: give existing projects a copy of the current
tenant column set so nothing moves on the day it ships, then let each project
diverge.

### 2. One assignee — DECIDED

`ProjectTask` keeps `assignee_id` **xor** `assignee_employee_id`, the pair Phase
2 added so an employee without a login can hold work. **No `ProjectTaskMember`,
no plural assignment for now.**

This is the cheaper and safer half of the question: that single field is read by
remaining-hours attribution, the burndown, the Tasks page's default "assigned to
me" filter, `assigneeOf()`, and every "who is this for" query in the module, and
going plural would force a decision about whose burndown a shared task belongs
to. 3G is therefore **deferred, not scheduled** — it comes back only if someone
actually asks to put two people on a card.

One consequence worth noting, already handled in 3A: the card must read *both*
assignee fields. The old card read only `assignee`, so every task held by an
employee without a login rendered as unassigned.

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

| Order | Item | Status | Why here |
|---|---|---|---|
| 1 | 3A | **shipped 2026-08-03** | Cards open and say something. Hours of work; changes how the board *feels* more than anything else on this list. |
| 2 | 3B | **shipped 2026-08-03** | Pure UI over finished endpoints. No schema, no risk. |
| 3 | 3E | next | Subtasks, the other half of "already returned, never rendered". |
| 4 | 3M + 3N | | Board becomes usable — create without leaving, filter, and work on a phone. |
| 5 | 3F + 3H | | First schema change; do labels and dates in one migration. |
| 6 | 3C + 3I | | Comments and activity together — the same panel, and activity is what makes comments findable. |
| 7 | 3L | | Per-project columns, per decision 1. Carries a data migration. |
| 8 | 3D | | Needs the `storage_key` fix, so it is the only item with a prerequisite outside this phase. |
| 9 | 3J + 3K | | Archive, then cover colour. |
| — | 3G | deferred | Per decision 2 — single assignee stands. |

---

## What shipped on 2026-08-03

**3A.** The board card is clickable (mouse, touch and keyboard) and opens the
existing `TaskDetailPanel`; closing it reloads the board so a status change made
in the panel is reflected in the columns. The card now renders the due date with
overdue / due-today / due-soon / done tones, HIGH and URGENT priority (MEDIUM
and LOW stay quiet — a badge on every card is not a signal), checklist progress,
comment and subtask counts, a description marker, remaining hours, and an
initials avatar that reads **both** assignee fields.

Two things worth recording because they are easy to get wrong:

- **`due_date` is compared as a string, not as a `Date`.** It is a `@db.Date`
  serialised at UTC midnight, so `new Date(due) < new Date()` marks a task due
  *today* as overdue for every timezone east of UTC — which is all of them here.
- **A drag that ends where it began reads as a click**, which would open the
  card you just dropped. The card tracks whether a native drag started and
  swallows the click that follows it.

**3B.** Checklists have a UI: progress count and bar, tick/untick, click-to-edit
rename (Enter saves, Escape discards), delete, and move up/down. The three
endpoints and their api-client methods already existed and had never been
called.

Reordering needed one new endpoint, `PATCH /project-tasks/:id/checklist/reorder`,
which takes **the whole order** and re-sequences it in a single transaction.
Moving one item by PATCHing two `sortOrder`s is the obvious client-side
shortcut and it is wrong: a half-applied swap leaves two items sharing a
position, and `checklistItems` orders by `sort_order` alone, so the list would
reshuffle on every subsequent read.

**Not done:** neither has been opened in a browser — both are verified by unit
tests, typecheck, lint and `next build` only.
