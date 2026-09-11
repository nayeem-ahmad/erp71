# Project Management — Phase 4: task entry, and watching remaining hours move

**Status:** proposed, nothing built
**Written:** 2026-09-11
**Predecessors:** `project-management-phase-1.md`, `-phase-2.md`, `-phase-3.md`

The ask: *"Task entry/edit UI is too cumbersome. Can you suggest a more
streamlined version? Also, where can we add a chart to show change of remaining
hours?"*

Two questions, one document. Part 1 measures what is actually heavy about
creating and editing a task and proposes a lighter shape. Part 2 answers where a
remaining-hours chart belongs, cheapest first.

As with Phase 3, most of the answer is already in the codebase — the backend is
almost never the constraint here.

---

## Part 1 — Why entry and edit feel heavy

Six findings. Each is a measurement, not an opinion.

### 1. Opening one card costs ten HTTP requests

`TaskDetailPanel` and its two self-loading children (`AttachmentsSection`,
`ActivitySection`) fetch on mount:

| # | Call | Where |
|---|---|---|
| 1–3 | `getProjectTask`, `getTaskRemainingHistory`, `getProjectLabels` | `TaskDetailPanel.tsx:170-172` (parallel) |
| 4 | `getProjectColumns` | `:183` — **sequential**, it waits for #1 to name the project |
| 5 | `getProject` (for the member roster) | `:199` |
| 6 | `getTaskAttachments` | `:995` |
| 7–10 | `getTaskComments`, `getTaskActivity`, `getTaskWatchers`, `getMe` | `:1128-1131` |

Ten round trips to look at one card, on connections that in the target market
are often a phone tethered over 3G. Six of them (#5–#10) feed sections that are
below the fold and are not what the card was opened for.

### 2. Every field edit throws away a response the client already has

`refresh()` (`:212`) is `await load()` — all four of the calls above — plus
`onChanged?.()`, which reloads the list behind the modal. It runs after *every*
single-field save.

It does not need to. `PATCH /project-tasks/:id` already returns the complete
updated task: `project-tasks.service.ts:526` ends `update()` with
`return this.findOne(viewer, taskId)`. The panel discards that response and
re-fetches the same object.

So changing status, assignee, estimate and due date on one card — a normal
Monday morning — is 4 writes and **16 wasted reads**, with the whole panel
`disabled` between each one because the update is not optimistic.

### 3. Five different ways to save, in one panel

| Field | How it saves | Where |
|---|---|---|
| Title | click the heading → input → Enter or blur | `:692` |
| Description | click a pencil → editor → **Save / Cancel buttons** | `:783` |
| Estimate | type → blur or Enter | `:622` |
| Status, assignee, dates | `<select>`/`<input>` → **on change** | `:317`, `:558`, `:1325` |
| Labels, cover | click a chip → saves immediately | `:1397`, `:898` |
| Hours + remaining | a real form with a Save button | `:227` |

Nothing on screen tells you which field behaves which way, so the honest user
strategy is "change one thing, wait, check it stuck, change the next" — which is
exactly the rhythm that reads as cumbersome.

Two of these fight the container: `TitleField` and `EstimateField` both call
`event.stopPropagation()` on Escape (`:678`, `:768`) so `ModalShell` does not
read it as "close the card" and take the edit with it. That is a symptom. A
panel with one editing idiom has no such conflict.

### 4. The create modal asks for six fields, and the assignee is not one of them

`/projects/tasks` → **New Task** sends `projectId`, `title`, `description`,
`priority`, `dueDate`, `estimateHours` (`tasks/page.tsx:258-265`).

`CreateTaskDto` (`project.dto.ts:268`) already accepts **fifteen**, including
`assigneeId`, `statusId`, `startDate`, `labelIds`, `sprintId` and
`remainingHours`. So the form omits the one field you always set next, and
includes a 4-row rich-text editor — the tallest control in the modal — for a
field most tasks never get.

The consequence is written into the page as a workaround: because a new task has
no assignee, it falls outside the page's default *assigned to me* filter, so
after saving, the code **force-opens `TaskDetailPanel`** so the task does not
appear to have vanished (`tasks/page.tsx:273-274`). Creating one task means
dismissing two modals. Creating ten means doing that ten times — there is no
*Save and add another*.

### 5. The most-used control is the seventh section down

Order in the panel's main column: description (`:371`) → checklist (`:377`) →
attachments (`:383`) → **log work** (`:386`) → time entries (`:454`) →
remaining-hours history (`:484`) → activity (`:534`). All inside
`max-h-[70vh] overflow-y-auto`.

Logging an afternoon — the single most frequent write in the whole module —
means opening a card and scrolling past three sections you did not come for. And
it duplicates `HourLogCaptureBar` on `/projects/hour-logs`, which does the same
job better: it has a timer, tags and a project/task picker.

### 6. The list itself is read-only

`/projects/tasks` renders ten columns and the only row actions are *open* and
*delete*. Every edit — including "mark it done", "give it to Rafi" — requires
opening the modal, i.e. the ten requests from finding 1.

---

## The streamlined version

Ordered by payoff per hour of work. Items are lettered to match the phase-3
convention.

### 4A — Quick add: one line, no modal

The pattern already exists in this module: `BoardCardComposer` puts an "add a
card" line at the foot of every board column. Bring it to `/projects/tasks` as a
sticky row above the table.

Type a title, press Enter, the task is created and the input stays focused for
the next one. Project defaults to whatever the list is filtered to — the logic is
already written in `openCreate` (`tasks/page.tsx:239-246`).

Optional detail rides in the same input as tokens, parsed client-side into the
`CreateTaskDto` fields that already exist:

```
Fix the invoice footer @rafi #bug !high ~3h >friday
```

`@` assignee · `#` label · `!` priority · `~` estimate · `>` due date. Unmatched
tokens stay in the title rather than being swallowed — a rule worth testing
explicitly, since a task titled "Email @bkash about the refund" must not silently
lose its text.

This is the single biggest win. The common case — capture a title, move on —
stops involving a modal at all.

### 4B — Reduce the full modal, and let it repeat

Keep it; it is the right control for carefully filing one task. But:

- One screen: project, title, assignee, due date, estimate. Priority defaults to
  MEDIUM and is a quiet link until changed. Description collapses to
  **+ Add description** and expands on click.
- Add **Save and add another**, which keeps the project and clears the rest.

### 4C — Default the assignee, then delete the auto-open workaround

Set the new task's assignee to the creator, or to whoever the list is filtered
by. The task then lands inside the current filter and simply appears in the
list — and `tasks/page.tsx:273-274` can go.

This also settles the standing TODO item about the board composer creating
title-only cards: with 4A's tokens, it does not have to.

### 4D — One editing idiom in the panel

Pick one rule and apply it everywhere: **text commits on blur or Enter, pickers
commit on change.** Delete click-to-edit and the pencil button entirely — title
and description become controls that look like text until focused.

That removes `TitleField`'s and `DescriptionSection`'s editing state machines,
both `stopPropagation` hacks, and the "which field is this one?" tax on every
edit.

### 4E — Use the PATCH response

`setTask(response)` instead of `await load()`. Four fewer requests per edit, and
the field updates instantly instead of after a round trip with the panel
disabled. Keep the parent-list refresh, but defer it to panel close.

Cheapest item on this list by a wide margin — roughly a day, no new endpoints, no
new strings.

### 4F — Reorder around frequency, and load the tail lazily

Main column, top to bottom: title · status · assignee · **work row** ·
description · checklist. Then attachments, time entries, remaining history and
activity as **collapsed sections with counts**, fetched when opened.

That alone takes opening a card from ten requests to three.

### 4G — The work row, and a timer on the card

Collapse the log-work form to one line — `hours · date · remaining · note ·
Save` — and put a **▶ Start** button beside it that starts the existing
`ProjectTimer` on this task (`POST /project-time/timer` already exists, and
`HourLogCaptureBar` already drives it). The common case becomes one click and no
typing.

### 4H — Edit from the list row

Status and assignee as inline selects in the `DataTable` row; priority and due
date behind a row menu. Most edits then never open the panel at all.

---

## Part 2 — Where the remaining-hours chart goes

Four candidates, cheapest first. The first one is the recommendation.

### 4I — In the task panel, above the history list ✅ start here

**Zero backend work. The data is already in the browser.**

`TaskDetailPanel` fetches `GET /project-tasks/:id/remaining-history` on mount
(`:171`) and holds it in `history` state. Each row carries `previous_hours`,
`new_hours`, `delta`, `source`, `note`, `changed_at` and the user
(`remaining-hours.service.ts:97-102`). That is already a complete time series of
remaining hours for the task — it is currently rendered as a list of arrows
(`:484-530`).

Put a small chart above that list and keep the list as the audit detail beneath
it. The list answers *what happened*; the line answers *are we converging*, which
is the question a person opening a card actually has.

Three things to get right:

- **Draw it as a step line, not a curve and not straight segments between
  points.** Remaining hours are constant between writes and jump at each write.
  `BurndownChart` already argues the milder version of this — *"deliberately
  straight segments, not a spline… a curve between them would draw hours that
  were never measured"* — and a step function is that principle taken one step
  further, because here we know the value held flat in between.
- **The x axis is `changed_at`, not the row index.** The writes are irregular;
  spacing them evenly would draw a fortnight's silence as one tick.
- **Colour the steps by `source`.** `TIME_LOGGED` steps down in blue,
  `RE_ESTIMATED` up in amber (scope growth is the thing the chart exists to
  expose), `TASK_COMPLETED` is the drop to zero. Plot `estimate_hours` as a flat
  grey reference line so "we have re-estimated past the original estimate" reads
  at a glance.

One caveat to fix while there: `remainingHistory` is an unbounded `findMany`
(`remaining-hours.service.ts:98`). A long-running task returns every row it ever
had, to draw a chart 720px wide. Cap it, or aggregate to one point per day.

Roughly 100 lines of SVG modelled on `BurndownChart`, plus legend strings in
nine catalogs.

### 4J — Project burndown on `/projects/[id]`

The manager's version of the same question. That page shows remaining hours as a
**single number today** (`[id]/page.tsx:193`) — a figure with no history, which
cannot distinguish a project converging from one that has been at 120h for three
weeks.

Most of the machinery exists:

- `buildBurndownSeries()` (`burndown.util.ts:76`) is pure and takes a
  `Map<dateKey, {remaining, committed}>` — it does not care whether that map came
  from a sprint.
- `SprintSnapshotService` already **replays** those figures from the
  remaining-hours log for any past date, because snapshots are treated as a cache
  rather than the truth.
- `ProjectTaskRemainingLog` carries `project_id`, so the same replay works
  project-scoped with no new writes.

What it needs:

1. **An index.** The log has `@@index([tenant_id, sprint_id, changed_at])` and
   `@@index([task_id, changed_at])` and **nothing on `project_id`**
   (`schema.prisma:6632-6633`). A project-scoped replay would sequential-scan.
   One migration.
2. `GET /projects/:id/burndown`, replaying on the fly to start with. Projects are
   small; add `ProjectSnapshot` rows and a cron only if it gets slow — the
   nightly job already has the shape (`projects.scheduler.ts:26`).
3. **A decision about the ideal line.** A sprint has fixed dates; a project's
   `target_end_date` is optional. Anchor the ideal line to
   `start_date`→`target_end_date` when both exist, and draw actual-only when they
   do not. Do not invent an end date.

Place it full-width directly under the four stat tiles (`[id]/page.tsx:189`), so
the number and its history are read together.

One thing to check first: `docs/projects/project-visibility.md` already reasoned
that a per-viewer burndown is worse than the aggregate leak it would fix. A
project-level chart sits inside a single project's visibility boundary, so it
does not reopen that question — but say so explicitly in the PR.

### 4K — Sprint burndown: already shipped

`/projects/sprints/[id]` renders `BurndownChart` from `GET /sprints/:id/burndown`
(`sprints/[id]/page.tsx:80-84`), and scrum mode on the board draws it above the
columns. Listed so nobody rebuilds it.

### 4L — A sparkline in the Remaining column

`/projects/tasks` has a **Remaining** column showing `Nh`
(`tasks/page.tsx:384-388`). `components/dashboard/Sparkline.tsx` is a 100×30
component that already exists. Putting the last ~10 remaining values beside the
number turns a static column into a trend.

Deliberately last: it needs per-task history on a **list** endpoint, which is an
N+1 unless it is one grouped query over the log. Worth doing only once 4I has
proven people read the shape.

### Not recommended

`/projects/hour-logs`. That page is about hours **logged**; remaining hours are a
forward-looking estimate. Two different quantities on one axis would mislead more
than it informs.

---

## Risks and things easy to under-estimate

- **i18n has grown to nine catalogs** — en, bn, ms, de, es, fr, hi, ur, ar — with
  parity enforced by `catalog.test.ts`, which fails on a missing key rather than
  letting it degrade. Phase 3 budgeted for three.
  Every chart legend and every token hint lands nine times.
- **`TaskDetailPanel.tsx` is 1,662 lines with a 1,144-line test.** 4D and 4F
  rewrite its structure. Do them as separate commits from 4E, which is a
  one-line-per-call-site change and should not be held hostage to a redesign.
- **`useServerList` swallows failures into an empty table** — still open in
  `TODO.md`, still true, and 4A/4H both add writes behind that list.
- **Token parsing is a parser.** 4A's `@ # ! ~ >` needs tests for the ambiguous
  cases (an email in a title, a `#` in a hex colour, a name with a space) before
  it ships, or it will quietly eat text people typed.
- **RTL.** ur and ar are live. A step chart's axis and legend need the same
  treatment `docs/rtl-guidelines.md` describes; `BurndownChart` predates two of
  those locales and is worth re-checking at the same time.

---

## Suggested sequencing

| Order | Item | Why here |
|---|---|---|
| 1 | **4E** | One day. Cuts four requests per edit and makes every field feel instant. No design decisions, no new strings. |
| 2 | **4I** | The chart, using data already fetched. Self-contained, no backend, visible immediately. |
| 3 | **4A + 4C** | The create path, and the workaround it lets us delete. Biggest felt change to entry. |
| 4 | **4F** | Ten requests → three, and the work row rises above the fold. |
| 5 | **4D** | One editing idiom. Largest diff of the phase; do it once the panel's section order has settled. |
| 6 | **4B + 4G** | The reduced modal and the timer button. |
| 7 | **4J** | Project burndown — the first item needing a migration and an endpoint. |
| 8 | **4H** | Inline row editing. |
| 9 | **4L** | Sparkline in the list, once 4I has proven the shape. |

Items 1 and 2 are independent of everything else and of each other. If the
appetite is one afternoon rather than a phase, do those two.
