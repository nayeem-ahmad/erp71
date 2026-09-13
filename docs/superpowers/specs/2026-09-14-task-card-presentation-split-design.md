# Task card — modal and page, and the chip row

**Status:** design, awaiting approval. No code written.
**Written:** 2026-09-14
**Predecessor:** `docs/projects/project-management-phase-4.md` (shipped 2026-09-12)
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

Status, assignee, due date, priority and labels are today five stacked controls
in the sidebar — four `<select>`s and a toggle grid. None can be typed into. A
20-person roster is a 20-option dropdown.

They become **one wrapping row of chips directly under the title**, each opening
a popover on click:

| Chip | Popover | Commits |
|---|---|---|
| Status | the project's columns, type-to-filter | on select (4D) |
| Assignee | project roster, type-to-filter, avatar + name | on select |
| Due | date input + `Today` / `Tomorrow` / `Next week` | on select |
| Priority | the four values | on select |
| Labels | catalogue as toggles, `onFirstOpen` fetch | on toggle |

A chip shows its value when set and its field name when not. Due renders amber
when overdue, via the existing `dueStateOf()`. Labels render through the
existing `labelClass()`; the fixed six-colour palette is tenant data, so the
one-accent rule does not apply (already documented in `board-tasks.ts`).

**One new component, `ChipPopover`,** built on the existing `Field`/`Input`
primitives — not a new dropdown library, and not per-chip bespoke markup.

### Facts stop being form controls

Sprint, milestone, start date, created-by become a key/value list that edits in
place on click, instead of four more controls competing with the five above.

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

- **`TaskDetailPanel.tsx` is 1,889 lines under a 1,478-line, 104-test suite.**
  The extraction is the risky part, not the chips. The suite mounts the default
  export with a mocked `api` and its `describe` blocks are per-section, so the
  tests survive **if and only if** accessible names are preserved — every
  section keeps its current label and every control its current `aria-label`.
  Do the extraction as its own commit with no behaviour change, prove the 104
  tests green, then land the chips.
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
| 1 | Extract `TaskCardBody`, no behaviour change | Prove 104 tests green before anything moves. |
| 2 | The route + `taskDetail()` + expand control | Small, independently shippable, no visual risk. |
| 3 | Chip row + `ChipPopover` | The payoff. Biggest diff; do it on a settled body. |
| 4 | Facts as key/value | Same sidebar, follows naturally from 3. |
| 5 | Read-first reorder | One move once 3 and 4 have settled the column. |
| 6 | Checklist drag | Independent of everything above. |
| 7 | Quick-add autocomplete | Different component entirely; can go any time. |

Steps 1 and 2 are safe to land alone. If the phase stops after 2, the card is
already shareable and nothing looks different.
