# Project Management — Phase 3: Trello-style task cards

**Status:** 3A, 3B, 3M, 3N, 3F, 3H, 3C and 3I shipped 2026-08-03; the rest scoped and sequenced below
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
| 3 | 3M + 3N | **shipped 2026-08-03** | Board becomes usable — create without leaving, filter, and work on a phone. |
| 4 | 3F + 3H | **shipped 2026-08-03** | First schema change; labels and dates in one migration. |
| 5 | 3C + 3I | **shipped 2026-08-03** | Comments and activity together — the same panel, and activity is what makes comments findable. |
| 6 | 3L | next | Per-project columns, per decision 1. Carries a data migration. |
| 7 | 3D | | Needs the `storage_key` fix, so it is the only item with a prerequisite outside this phase. |
| 8 | 3J + 3K | | Archive, then cover colour. |
| — | 3E | postponed | Subtasks on the card — dropped from the queue on request, not cancelled. |
| — | 3G | deferred | Per decision 2 — single assignee stands. |

---

## What shipped on 2026-08-03

3A, 3B, 3M, 3N, 3F, 3H, 3C and 3I. 3E (subtasks on the card) was postponed on
request — the card badge for it already ships, only the panel section is
outstanding.

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

**3N — the board works on a phone.** HTML5 `draggable` is gone; dragging is
pointer-based, which covers mouse, touch and pen in one path.

The awkward part is that touch has to serve two gestures on the same surface:
scrolling a column and picking up a card. Making the whole card touch-draggable
would have cost the scroll. So the card body arms a drag **only for a mouse**
(with a 6px threshold, below which the gesture is the tap that opens the card),
and touch drags start from a **grip** that opts out of `touch-action`. A ghost
follows the pointer, because on touch there is no cursor to tell you the card
has been picked up, and a blue bar shows where it will land.

The geometry — which column the pointer is over, which insertion point, and
whether the gesture passed the threshold — lives in `board-drag.ts` as pure
functions. jsdom has no layout, so a component test cannot answer "which card is
the pointer over"; handing those functions rectangles directly can.

**3N — filters.** Assignee, priority and due (overdue / today / this week / no
date), applied client-side over the board that is already loaded, so there is no
new request and no new query parameter. The assignee list is built from the cards
present rather than the project roster: you can only usefully filter by someone
who holds a card here. A label filter arrives with 3F.

One trap worth recording: **the server reorders against the whole column, not
the filtered one.** Dropping a card "above the second visible card" while a
filter is on would otherwise land it at position 1 of twenty, jumping it over
every hidden card. `toFullIndex` maps the visible position back onto the full
column.

**3M — add a card in place.** A composer at the foot of every column: type a
title, press Add, keep typing. It stays open with an empty field so a column can
be filled in one go, and keeps the text if the save fails. Anything beyond a
title is the detail panel's job.

**A test-infrastructure fix came out of this.** jsdom implements no
`PointerEvent`, and Testing Library's fallback silently drops `pointerType`,
`pointerId` and `button` — a handler branching on any of them sees `undefined`
and takes a path it would never take in a browser. The first version of the
touch tests passed for exactly that wrong reason. `jest.setup.ts` now polyfills
`PointerEvent` over `MouseEvent`, which is what made the mouse and touch paths
genuinely distinguishable; any future pointer-driven UI inherits it.

**3F — labels.** `ProjectLabel` + a `ProjectTaskLabel` join, chips on the card,
a fourth filter on the board, and management in project settings beside the
board columns. Colour is an **enum, not a hex string**: the UI rules forbid
arbitrary hex, and a free colour field is how a board ends up with twelve
indistinguishable greys. Each value maps to a Tailwind class pair written out in
full, because Tailwind scans source text and `bg-${color}-100` compiles to
nothing.

**Labels are tenant-scoped, not per-board — and that is a deliberate departure
from decision 1.** A label is a vocabulary ("Blocked", "Client waiting"), and
the cross-project Tasks page and the tenant-level sprint board are only useful
if that vocabulary is shared; per-board labels would fragment it exactly the way
per-project statuses would. Columns are structural and belong to a board; labels
are descriptive and belong to the workspace. If a board ever needs private
labels, adding `project_id` is additive.

Two details in the write path. The endpoint **replaces** a task's whole label
set rather than patching it, so a toggle sends everything that should remain and
there is no add/remove pair to keep in step — `undefined` still means "leave
alone", and `[]` means "remove them all". And every id is **checked against the
tenant before writing**: the join row carries a `tenant_id` that nothing else
validates, so an unchecked id would let one tenant tag with another's label.

Deleting a label in use is allowed rather than refused — unlike a board column,
which still blocks on tasks. Retiring "Blocked" from the vocabulary should not
mean untagging fifty cards first; the join rows cascade and the tasks are
untouched. The response reports how many were untagged.

**3H — dates.** `start_date` joins `due_date`, and both are editable in the
panel, saving on change. Clearing needed a backend fix that is worth knowing
about: `@IsOptional()` skips only `null` and `undefined`, so an empty string
reaches `@IsDateString()` and 400s — while PATCH reads `undefined` as "leave
alone". Without a `@ValidateIf`, **"no due date" was not expressible at all**.
The date fields now accept `''` explicitly.

The same pattern is worth auditing elsewhere: `UpdateProjectDto` has
`@IsOptional() @IsUUID() customerId`, and the Phase 2 project edit form sends
`''` to clear a customer link — which by this reasoning 400s. Logged in
`TODO.md` rather than fixed here.

Also fixed in passing: `Field` only associates its label with the control when
given `htmlFor`, so a `Field`-wrapped input has no accessible name. The new date
inputs pass it. Most of the app does not — logged.

**3C — comments.** `ProjectComment` had a model and a `CreateCommentDto` since
Phase 1 and no service or controller behind either. It has both now: list,
create, and edit or delete **your own only** — the feed is an audit trail, and
nobody rewrites anybody else's line in it. That rule lives in the service rather
than in a permission, so it cannot be granted away.

**3I — activity and watchers.** `ProjectTaskActivity` is append-only, and
`ProjectTaskWatcher` says who hears about a task. `data` holds the before/after
payload rather than a rendered sentence, so the line is composed client-side and
**therefore translates** — a stored English string would be permanently English
in a trilingual app.

There is no `COMMENTED` activity type. Comments are their own rows and the panel
merges the two streams by timestamp, so a row per comment would draw every
comment twice.

**Watchers actually do something**, which is the difference between this and
bookkeeping: they fan out to the existing in-app `Notification` table when a
task moves, is reassigned, or gets a comment. Nobody is ever notified of their
own action — being told what you just did is how a notification bell stops being
read. You are subscribed automatically on creating a task, being assigned one,
or commenting on one; a watch list nobody is ever added to is a feature nobody
uses.

**Everything in the activity service is best-effort and never throws.** A task
move that succeeded must not report failure because an audit row would not write
or a notification would not send. `record`, `watch` and `notifyWatchers` all
catch and log.

One ordering detail with a test on it: a comment **notifies before it subscribes
the author**. The other way round, the author is in the watcher set by the time
the fan-out reads it and gets told about their own comment. The actor filter
alone would cover it; the ordering makes the intent survive a refactor of that
filter.

Activity is recorded per *field that actually changed*, not once per save, so
the feed reads as a list of edits rather than "updated the task" repeated
forever — and a field submitted unchanged records nothing. Dropping a card back
into the column it came from is likewise not news.

Comments, watching and the feed are gated on `VIEW_PROJECTS` rather than
`MANAGE_PROJECT_TASKS`: if you can see the board you can discuss it and
subscribe to it. That avoids a new permission and the backfill migration one
would need.

**Not done:** none of this has been opened in a browser — it is verified by unit
tests, typecheck, lint and `next build` only. **Neither migration has been run
against a real Postgres**, only validated by `prisma validate` and hand-written
to match the schema; it is purely additive (one nullable column, two new tables,
one new enum), which is the cheapest shape to deploy but not a substitute for
running it.
