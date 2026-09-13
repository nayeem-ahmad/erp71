# Task card — modal and page, and the chip row

**Status:** design, awaiting approval. No code written.
**Written:** 2026-09-14
**Predecessor:** `docs/projects/project-management-phase-4.md` (shipped 2026-09-12)
**Baseline:** `dev` as of the 2026-09-14 merge of 35 upstream commits, which
added the user-story axis, the floating time tracker and board backgrounds.
**Mockup:** https://claude.ai/code/artifact/ffa6b3e8-d0ea-41f5-8326-db7303be2013

The ask: *"Want to improve the UI/UX of task entry/edit. Take inspiration from
Trello or similar. Want to see a visual mockup before implementation."* Then,
after the mockup: *"Can we accommodate with a modal?"* and *"Let's keep a modal
view and a full-page view."*

Phase 4 answered almost exactly this ask two days earlier and shipped nine
items. **This document is deliberately narrow: it carries only what Phase 4 did
not do, plus one decision that revises a Phase 4 call.** Anyone reading this
should read Phase 4's Part 1 first — its six findings are still the measurement
that matters.

---

## What Phase 4 already settled (do not re-do)

| Shipped | Where it landed |
|---|---|
| Quick add as one line with a token grammar | `TaskQuickAdd.tsx`, `task-quick-add.ts` |
| Reduced, repeatable create modal (`Save and add another`) | `tasks/page.tsx` |
| One editing idiom — text commits on blur/Enter, pickers on change (**4D**) | every field on the card |
| Three requests to open a card instead of ten (**4E**, **4F**) | `apply` / `applyWithLog` / `refresh` |
| Section order + collapsed tail with counts (**4F**) | `TaskDetailPanel`, `CollapsibleSection` |
| Work row as one line with a timer (**4G**) | `TaskDetailPanel` |
| Inline status/assignee edit from the list row (**4H**) | `tasks/page.tsx` |
| Remaining-hours chart (**4I**) | `RemainingHoursChart` |

Two consequences for this document:

- **The editing idiom is fixed.** Every new control here commits on the 4D rule.
  No new click-to-edit, no new Save/Cancel pairs.
- **The lazy tail is fixed.** Anything new that needs a fetch goes behind
  `CollapsibleSection`'s `onFirstOpen`, not into the mount path.

---

## Decision 1 — the card gets two presentations

**Modal stays the default. A page is added. One body serves both.**

Today `TaskDetailPanel` *is* a `ModalShell`, and all three callers
(`projects/tasks`, `projects/boards/[id]`, `projects/[id]`) hold `openTaskId` in
local state. `projects/my-tasks` is a 14-line legacy redirect and is not a
caller.

The split:

- `TaskCardBody` — presentation-agnostic. All the sections, none of the shell.
- `TaskDetailPanel` — unchanged public API (`taskId`, `onClose`, `onChanged`);
  renders `ModalShell` + `ModalHeader` + `TaskCardBody`. **Still the default
  export, so no caller changes and the existing suite keeps mounting it.**
- `app/(app)/projects/tasks/[id]/page.tsx` — `PageShell` + `PageHeader` +
  `TaskCardBody`.

**Why a modal cannot do the whole job.** `ModalShell` is
`max-h-[90vh] overflow-hidden`; the panel puts `max-h-[70vh] overflow-y-auto`
inside it. That nesting is inherent to a modal, and it costs: a wheel event
lands in whichever scroller the pointer is over, there is no URL to paste, and
browser Back does not close a card. The house rule in
`docs/ui-design-guidelines.md` §2.7 already says "anything with tabs or >~10
fields should be a page, not a modal" — this card has ten sections and a chart.

**Why the modal nevertheless stays the default.** Opening a card from a board is
a peek, and navigating away from a board loses scroll position, filter state and
the column you were reading. The modal is the right default *because* most opens
are peeks.

### Getting from one to the other

- `ModalHeader` already accepts `children` into its action row — **no primitive
  change needed.** An expand control goes there, linking to
  `routes.projects.taskDetail(id)`.
- `routes.ts` gains a `taskDetail(id)` builder beside the existing
  `projects.tasks`, returning `/projects/tasks/<id>`.
- `projects/tasks/` has no `[id]` child today, so the route collides with
  nothing.

### The cold landing

Someone opens `/projects/tasks/<id>` from a pasted link with no history behind
it. Close and the last breadcrumb both go to
**`routes.projects.detail(task.project.id)`**.

A task has no board foreign key. `BoardTask` joins a task to *hand-picked
cross-project* `Board`s and a task can be on none of them; per-project columns
(Phase 3L) belong to the project. So "its board" is unambiguously the project,
which is also always a real destination.

Breadcrumbs use the existing `projectChildBreadcrumbs(home, projects, project,
pageLabel)`, which already drops the project segment rather than faking it while
the fetch is in flight.

---

## Decision 2 — the five selects become one chip row

This is the largest felt change and the reason to do the work.

Status, assignee, **user story**, due date, priority and labels are today six
stacked controls in the sidebar — five `<select>`s and a toggle grid. None can
be typed into. A 20-person roster is a 20-option dropdown, and a groomed backlog
is a dropdown of every story in the project.

`UserStoryField` landed upstream on 2026-09-13 (`ProjectUserStory`, filed beside
`milestone_id` rather than reusing `parent_task_id`). It is the sixth field and
the newest argument for this change: the sidebar grew again, in the same idiom,
and will keep growing.

They become **one wrapping row of chips directly under the title**, each opening
a popover on click:

| Chip | Popover | Commits |
|---|---|---|
| Status | the project's columns, type-to-filter | on select (4D) |
| Assignee | project roster, type-to-filter, avatar + name | on select |
| Story | project backlog, type-to-filter, `US-3 · title` | on select |
| Priority | the four values | on select |
| ~~Due~~ | *deferred* — needs start + due and their inverted-range check | — |
| ~~Labels~~ | *deferred* — `LabelsSection` already toggles chips in place | — |

A chip shows its value when set and its field name when not. Due renders amber
when overdue, via the existing `dueStateOf()`. Labels render through the
existing `labelClass()`; the fixed six-colour palette is tenant data, so the
one-accent rule does not apply (already documented in `board-tasks.ts`).

**One new component, `ChipPopover`,** built on the existing `AnchoredDropdown`
(`components/document-entry/AnchoredDropdown.tsx`) — not a new dropdown library,
and not per-chip bespoke markup.

`AnchoredDropdown` rather than the simpler in-flow pattern `BoardViewMenu` uses,
for one reason: in the modal the chip row sits inside `overflow-y-auto`, which
is the exact clipping `AnchoredDropdown` was written to escape (it portals into
`document.body` and flips above the anchor when the room below runs out). The
interaction grammar still follows the module's own precedent — `BoardViewMenu`
for `useDismissOnClickOutside`, Escape returning focus to the trigger, and
`aria-expanded` / `aria-haspopup` / `aria-controls`; `PartySearchSelect` for
type-to-filter with arrow keys and Enter.

### Decided 2026-09-14: four chips first, dates and labels later

Chips for the four *pickers* only — **Status, Assignee, Story, Priority**.
`DatesSection` and `LabelsSection` stay exactly as they are for now.

Why split it: the four pickers are where the unsearchable-`<select>` complaint
actually bites (a 20-person roster, a groomed backlog), and they are the cheapest
to prove `ChipPopover` on. Dates are the fiddly case — `DatesSection` edits start
*and* due with a cross-field inverted-range check between them, so a single "Due"
chip would silently drop both; that needs a popover holding two inputs and its
own validation, and is not worth bundling into the first pass.

**What this costs in tests, which the earlier draft of this document did not
say.** Thirteen of the 98 panel tests assert on *native form-control values* for
these fields. A chip has no `value`, so this pass rewrote **nine** of them: the
seven in the `assignee` block, the one in `board columns`, and one in `saving
without re-reading the card` that drove a status change through
`fireEvent.change`. Dates staying put is what kept the other four untouched.

Two of those nine turned out to be worth more than a mechanical port:

- **`board columns`** asserted `findByText('Site visit')`, which passed only
  because a `<select>` renders every option into the DOM permanently. A chip
  names just what the card is set to, so the test now opens the popover — which
  is what "the card offers its own board's columns" actually means.
- **The assignee block's four `updateProjectTask` payload assertions carried
  over unchanged**, which is the real evidence the port preserved behaviour: the
  same PATCH, both columns still cleared together, `''` still meaning nobody.

**Priority is a new field on the card, not a replacement.** It appears nowhere in
`TaskDetailPanel` today — only in the create modal and the list filters — so the
priority chip adds an edit the card never had. `UpdateTaskDto` already accepts it
(`@IsEnum(ProjectPriorityDto)`: LOW / MEDIUM / HIGH / URGENT), so this is
frontend-only.

**The `''`-clearing risk is already handled.** Every field these chips can clear
— `assigneeId`, `assigneeEmployeeId`, `userStoryId`, `milestoneId`, `sprintId`,
`startDate`, `dueDate`, `coverColor` — already carries
`@ValidateIf((_, value) => value !== '')` in `UpdateTaskDto`. The trap logged in
`TODO.md` does not apply to anything here.

### Facts stop being form controls

**Corrected 2026-09-14, before starting step 4.** This section was written
against the mockup rather than the code, and most of what it promised to convert
does not exist on the card. There is no sprint row, no milestone row and no
created-by row in the sidebar — so there are no "four more controls" to demote.
The same mistake as the "five selects" (there were six); the lesson is the same,
so it is recorded rather than quietly rewritten.

What is actually true:

- `TASK_INCLUDE` already returns `milestone {id, name}` and `sprint {id, name,
  status}` on every task read, and the frontend `Task` interface does not declare
  either — so the data arrives on the wire and is thrown away. Surfacing them is
  *new* display, not a conversion.
- `UpdateTaskDto` accepts `milestoneId` and `sprintId`, both with the
  `@ValidateIf(value !== '')` guard, so both are editable without backend work.
- **But only sprint has a list endpoint.** `api.getSprints(projectId)` exists;
  there is no `getProjectMilestones`. A milestone picker therefore needs an
  endpoint first, which is out of scope here.
- The genuinely read-only facts are logged and remaining hours, drawn today by
  the `Metric` pair.

So step 4 is: **show sprint and milestone as read-only facts** beside logged and
remaining, make **sprint** editable through a `ChipPopover` (the list endpoint
exists), and leave milestone as a fact until it has one. Start and due stay in
`DatesSection` for the reason Decision 2 already gives.

---

## Decision 3 — read-first order, revising 4F

**This revises a Phase 4 decision and should be read as such.**

4F put the work row above the description on the measured grounds that logging
an afternoon is the module's most frequent write, and that it previously sat
seventh. That reasoning was sound for the modal.

Asked directly what someone opens a card *to do*, the answer was **"read and
understand the work."** So:

- Description and checklist lead the main column.
- The work row stays **one line** (4G's shape, unchanged) and moves directly
  below them — still above the collapsed tail, still never seventh.
- The timer button moves into the header action row, where it is reachable
  without scrolling at all.

**Open question the merge of 2026-09-14 raised.** A floating `TimeTracker` panel
now mounts from `(app)/layout.tsx` and follows a running clock across every
page, while `TimerButton` remains on the card — so a card with a running timer
shows the clock twice. The house rule in `docs/ui-design-guidelines.md` §2.8
permits the panel (it duplicates an inline entry point rather than replacing
one), but the card's own button is now the *start* affordance more than the
*stop* one. Proposal: the card keeps Start and drops its Stop to the panel,
which is where a running clock already lives. **Flagged rather than decided —
it belongs to whoever owns the tracker.**

Net effect versus 4F: logging costs one short scroll on a long card and zero on
a short one; reading costs nothing. The regression risk is real and named here
so it can be reverted on evidence rather than argued about.

---

## Decision 4 — the smaller items

- **Checklist drag handles** replace the ▲▼ pair. `reorderTaskChecklist(taskId,
  ids)` already takes the whole order, which is exactly what a drag produces.
  **Precedent, not reuse:** `board-drag.ts` exports pure geometry helpers
  (`movedFar`, `resolveDropTarget`, `toFullIndex`) keyed to columns and cards —
  two-axis, board-shaped, and not a drag controller a vertical list can call.
  Take its *approach* (pointer events, so touch works on iOS Safari and Android
  Chrome, where HTML5 `draggable` fires nothing) and its `DRAG_THRESHOLD_PX`,
  and write a single-axis reorder for the checklist. No library. Keep the arrow
  buttons as the keyboard path, since a drag handle alone is not accessible.
- **Quick-add autocomplete.** Typing `@`, `#`, `!`, `~` or `>` opens a filtered
  popover under the caret. **`parseQuickAdd` is not touched** — its
  no-silent-swallow rule is the thing that makes the grammar safe, and the
  popover only makes the vocabulary visible. An unmatched token still stays in
  the title.

---

## Not doing

- **Subtasks on the card** — Phase 3E, postponed on request, still postponed.
- **Tabs.** Ten sections tempt tabs; collapsed sections with counts (4F)
  already solved discoverability more cheaply, and tabs hide the counts.
- **A page-only card.** Rejected above.
- **Touching `assigneeId` tenant validation.** Real and logged in `TODO.md`, but
  a backend authorization bug is not this change.

---

## Costs, honestly

- **`TaskDetailPanel.tsx` is 1,997 lines under a 1,478-line, 98-test suite.**
  The extraction is the risky part, not the chips. The suite mounts the default
  export with a mocked `api` and its `describe` blocks are per-section, so the
  tests survive **if and only if** accessible names are preserved — every
  section keeps its current label and every control its current `aria-label`.
  Do the extraction as its own commit with no behaviour change, prove the 98
  tests green, then land the chips. (98 is the runner's figure. An earlier draft
  of this document said 104, counted with `grep -c 'it(\|test('`, which also
  matches `edit()` and similar identifiers — a reminder to take the count from
  the runner, since a wrong gate makes a correct extraction look like it lost
  six tests.) Note that `UserStoryField` arrived with no
  test of its own, so the story chip needs one written rather than adapted.
- **Nine i18n catalogues.** `catalog.test.ts` collects full key paths from `en`
  and asserts deep equality for every locale, so a missing key fails the build
  rather than degrading. New strings: the expand control, the due-date presets,
  the chip empty-state names. Every one lands 9×, including ur and ar.
- **RTL.** ur and ar are live. A popover anchored to a chip needs logical
  properties, not `left`/`right` — `docs/rtl-guidelines.md`.
- **Mobile.** The chip row must wrap, not scroll sideways, and every chip needs
  `min-h-touch`. The page view is the better mobile experience but the modal
  stays the default there too, per the decision above.

---

## Sequencing

| Order | Item | Why here |
|---|---|---|
| 1 | Extract `TaskCardBody`, no behaviour change | Prove 98 tests green before anything moves. |
| 2 | The route + `taskDetail()` + expand control + `useTaskCard` | Independently shippable, no visual change — but **not small**: see below. |
| 3 | Chip row + `ChipPopover` | The payoff. Biggest diff; do it on a settled body. |
| 4 | Sprint + milestone as facts; sprint editable | Surfaces two fields the API already sends. Milestone stays read-only — no list endpoint yet. |
| 5 | Read-first reorder | One move once 3 and 4 have settled the column. |
| 6 | Checklist drag | Independent of everything above. |
| 7 | Quick-add autocomplete | Different component entirely; can go any time. |

Steps 1 and 2 are safe to land alone. If the phase stops after 2, the card is
already shareable and nothing looks different.

**Correction, written while doing step 2.** This document called step 2 "small".
It is not. A page cannot mount `TaskCardBody` without the card's state and
handlers, which lived inside `TaskDetailPanel` — so step 2 also had to lift 252
lines (the task, the four lazy fetches keyed on first touch, `apply` /
`applyWithLog` / `refresh`, `markChanged` / `close`, `saveWork`, `changeStatus`,
`deleteEntry`) into a `useTaskCard` hook that both presentations call. The
alternative was a second copy of how a card loads and saves, which would drift
on exactly the subtle rules — trusting a PATCH response, and catching a
blur-commit that lands after the card is closed.

It stays behaviour-free and the gate still holds (98/98, lint clean, no new
`tsc` errors), but "small" understated it, and the sequencing table above now
says so.
