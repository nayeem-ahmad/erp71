# Task page — from "modal body on a grey page" to a finished page

**Status:** implemented 2026-09-25, all seven phases, with the six decisions
taken as recommended. What shipped against this plan is at the end.
**Written:** 2026-09-25
**Predecessor:** `2026-09-14-task-card-presentation-split-design.md` (3P, all seven
steps shipped 2026-09-14). Read its "What Phase 4 already settled" table first.
**Mockup:** https://claude.ai/artifact/P7K5uDx1VnBmFv1XxxNCqt — desktop at 1440px,
phone at 390px, and five states (logging time with a clock running, the labels
picker, the header's ⋯ menu, a brand-new task, and a task you cannot see).

The ask, with a screenshot of `/projects/tasks/<id>` at 1913px wide: *"Task
entry/edit UI (full-page) looks so unfinished. Help me improve it
significantly. Suggest a plan."*

---

## What stays settled (do not re-do)

| Decision | Source |
|---|---|
| One body, two presentations. The modal stays the default from every list and board; the page is for links and a card kept in its own tab. | 3P decision 1 |
| The 4D editing idiom: text commits on blur/Enter, pickers commit on pick. No new Save/Cancel pairs. | Phase 4 (4D) |
| Read-first order: description, then checklist, then the record. | 3P decision 3 |
| One field per line in the sidebar, caption on the left. | Asked for 2026-09-14 |
| Start date stays off the card, and the cover colour stays derived from the first label. | 2026-09-14 restructure |
| **Opening the modal costs three requests.** Nothing here adds to the modal's mount path. | 4E/4F; the "three requests" test |

Everything below is either styling the page never got, or a bug that only
shows on the page.

---

## Why the page looks unfinished

The page is the modal's body dropped onto `PageShell`. 3P step 2 was
deliberately "no visual change", and the body was drawn for a white modal
panel. Put on the grey canvas at desktop width, eleven things show.

| # | What you see | Cause |
|---|---|---|
| 1 | Sections look like wireframes | Every section is `rounded-md border border-gray-200 p-3` with **no background**, so it reads as an outline on `bg-canvas`. The project page next door uses white cards, as §2.4 of the UI guidelines requires. |
| 2 | Four different section styles on one screen | Description's heading sits outside a grey-filled box. Checklist and Log time put their heading inside an outline. Labels is a `CollapsibleSection` with a chevron. The tab strip has no container at all. Headings are `font-medium`, not the §2.3 `font-semibold`. |
| 3 | The page ends in empty space | The record tabs start with nothing selected (`useState<RecordTab \| null>(null)`). That is right for the modal's three-request budget, but a page is a deliberate visit and there is nothing under the strip. |
| 4 | An empty description looks like a disabled textarea | A 160px grey-filled button with its placeholder centred vertically (`min-h-[10rem] … bg-gray-50`). |
| 5 | Log time is a card with a heading, a button with the same words, and a stray sentence | The hint *"Defaults to what is left after these hours…"* renders outside the hidden form, so it describes fields that are not on screen. |
| 6 | **The title cannot be edited on the page** | The modal puts `TitleField` in its header. The page passes `task.title` to `PageHeader` as plain text. This is a bug, not a styling issue. |
| 7 | The task has no identity | The key `PRJ-0002-15` shows nowhere: `reference` arrives on every read but is not in the frontend `Task` type. The last breadcrumb says "Task", and the subtitle repeats the project breadcrumb. |
| 8 | Captions and values sit ~300px apart | `md:grid-cols-3` makes the sidebar a third of the page (~520px at 1913px), and `FieldRow` right-aligns the chips. Meanwhile the description runs ~1,050px per line. |
| 9 | The sidebar is a column of identical blue pills | `ChipPopover`'s default tone is `border-blue-200 bg-blue-50 text-blue-700` for every set value, so status, priority and sprint look alike and none carries meaning. |
| 10 | Labels are hidden and the due date gets a whole card | `LabelsSection` is collapsed by default, even when the task has labels. `DatesSection` is a card holding one native `dd/mm/yyyy` input. |
| 11 | A deleted or private task shows "Loading…" forever | `useTaskCard` does `loadTask().catch(() => setTask(null))`, and the page treats `!task` as loading. A pasted link to a deleted task, or a private project you are not on, never resolves. |

Two more show once a tab is opened:

- **The Comments tab is headed "Activity".** `ActivitySection` always renders
  `t.projects.activity.title` in its own bordered box, with a Watch button
  and a hint, inside the tab panel: a box in a box. Attachments does the same
  under its own tab name. Watch is a task-level action, but it can only be
  reached inside a tab.
- **The hour log doesn't say who logged each entry.** `timeEntries.user` is on
  every read and is not displayed. Deleting an entry doesn't ask first.

---

## The design

The mockup has every screen described here. Class names below are the
intended Tailwind, so the build can be checked against the mockup side by
side. That check is what caught three undelivered items last time.

### Page frame

- `PageShell maxWidth="wide"` caps the content at 1200px. On a 1913px screen
  the page centres rather than stretching the description to 1,050px lines.
  *(Decision 1 below.)*
- Grid: `grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]`. The
  sidebar is a fixed 20rem from `lg` up. Below `lg` everything stacks, details
  first as today. Keep `grid-cols-1` and `min-w-0`; the phone-width comments
  in `TaskCardBody` explain why both are load-bearing.

### Header (`PageHeader`, still mandatory)

- **Title:** `TitleField` in a page variant: an auto-growing single-line
  `textarea`, so long titles wrap instead of scrolling inside an input.
  Heading type, commits on blur and Enter, and Escape reverts. The `h1`
  stays; the textarea sits inside it.
- **Subtitle:** a key chip `PRJ-0002-15` with a copy icon (copies the key),
  then "in *Kraftize*" linking to the project.
- **Breadcrumb:** the last crumb is the key, not the word "Task".
- **Actions:** `Watch` (pressed state shows "Watching · 3"), `Copy link`, and
  `⋯`, which holds **Copy task key**, **Open project** and **Delete task…**
  (`ConfirmDialog` with the existing `deletePrompt`, then back to the project
  with the existing `deleted` toast). `Back` goes: the project crumb and
  *Open project* both lead there. Per §2.10, *Copy link* folds into `⋯`
  below `md`.
- `document.title` becomes `PRJ-0002-15 · <title>`, because the page's stated
  purpose is "a card kept open in its own tab".

### Sidebar card 1 — Details, as a property list

One `grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4` for all rows, so the
caption column sizes to its longest label. That keeps Bangla's ~20% longer
labels from truncating, without fixed widths. Each caption has a 14px icon.
Each value is a **quiet chip**: `ChipPopover variant="field"`, drawn as
`rounded-md px-2 py-1 text-sm` with no border until hover, and `text-gray-400`
when empty. Colour appears only where it means something:

| Row | Value | Colour rule |
|---|---|---|
| Status | dot + column name | dot by category: TODO gray-400, IN_PROGRESS blue-600, DONE emerald-600 |
| Assignee | `Avatar` initials + name | none |
| Priority | flag + name | URGENT red-600, HIGH amber-600, MEDIUM gray-500, LOW gray-400 |
| Due date | `30 Sep 2026` + "in 5 days" | overdue in red with an "Overdue 3d" pill, via the existing `dueStateOf()` and `Intl.RelativeTimeFormat` |
| Labels | the label chips themselves, then a dashed `+` | label palette (tenant data, exempt from the one-accent rule) |
| Story | `KRF-12` + title, truncated | none |
| Epic | read-only, via the story | none |
| Sprint | name + "Active" badge when active | none |
| Milestone | read-only, only when set | none |

- **Due date** moves into this list, and `DatesSection` goes. Start date is
  already off the card, so the cross-field check that deferred a dates chip in
  3P no longer applies. The quiet chip opens the native picker through
  `showPicker()` on a hidden `<input type="date">`, falling back to focusing
  the input. A `×` clears it by sending `''`, as today.
- **Labels** are visible without a click. `+` opens `ChipPopover multiple`: a
  filterable checklist that stays open and saves each tick as today (the
  whole set plus the derived `coverColor`). It marks which label sets the
  card colour. The catalogue still loads on first open.
- **Footer:** "Created 12 Sep 2026 by Tania Akter · Updated 2 hours ago".

### Sidebar card 2 — Time

Everything about hours in one place, which is where the timer was moved on
2026-09-17 at your request:

- Estimate / Logged / Remaining, three across. The labels drop "(h)" because
  the values already say "h". The estimate shows a pencil and `—` when empty,
  so it reads as editable.
- The sparkline, with a caption: "Remaining over time · 8h → 5h".
- `Start timer` and `Log time` side by side. A running clock shows
  `■ Stop 00:42:17` in the blue "active" tint, not red, because stopping is
  not destructive.
- **Log time moves here from the main column.** The form opens in place:
  hours and date on one row, then remaining-after, then note. The hint shows
  only while the form is open, and it states its own arithmetic ("Leave
  blank to keep 3.5h"). *(Decision 2 below.)*

### Main column

- **Description** is a white card. The heading row gets an `Edit` ghost
  button when there is text; clicking the text still edits, per 4D. Empty is
  one dashed prompt ("Add a description" plus a hint about markdown and
  pasted screenshots), about 56px tall, not 160.
- **Checklist:** heading, "2 of 4", progress bar and `Add item`. Row arrows
  and delete appear on hover and focus from `md` up. Below `md` they collapse
  into a 44px `⋯` per row, and the grip stays. Empty is the heading row
  alone with "No steps yet".
- **Record** is a card whose header *is* the tab strip. Tabs: Comments ·
  Activity · Hour log · Remaining · Attachments, with counts where they are
  free.
  - The page opens on **Comments**, with `?tab=` in the URL so a link can open
    a tab. The modal still opens closed, which keeps its request budget.
  - The inner box, heading, Watch button and watch hint come out of
    `ActivitySection` and `AttachmentsSection`. Watch lives in the header. Its
    hint becomes the button's tooltip.
  - Comments get a 28px avatar, name, relative time (absolute on hover), and
    Edit/Delete on your own. The composer has your avatar and a one-line
    hint.
  - The hour log gets who logged each entry, and delete asks first.

### States

- **Not found / no access** replaces the endless "Loading…": "This task isn't
  available — it may have been deleted, or it's in a private project you're
  not on", with *Go to Tasks*. `useTaskCard` gains `loadError`, which reads
  `ApiError.status`. `findOne` answers 404 for both a deleted task and a
  private project the viewer is not on (its `taskFilter` hides the row). A
  missing `VIEW_PROJECTS` permission gives a 403. One message covers 404
  and 403. A network or 5xx failure gets *Try again* instead. The modal
  uses the same state.
- **Loading** is a skeleton in the shape of the page (`animate-pulse`, §2.7),
  not a line of text.

### Backend: additive, no migration

`findOne` only, not the shared `TASK_INCLUDE` the lists use:

- `creator: { select: { id, name, email } }` for "Created by". `created_by` is
  already written on create.
- `userStory.epic: { select: { id, code, title } }` for the Epic row. This
  also closes the TODO "Epics are absent from … the task panel".
- `_count.attachments` for the tab count.
- `viewer_watching` and a watcher count, from `watchers` filtered to the
  viewer. The header's Watch needs no extra request, so the modal's budget
  holds.

`reference` needs no backend change: it is already on every read. The
frontend composes the key as `${project.code}-${reference}`, which is the
same rule as `composeTaskKey`.

---

## Sequencing

Every phase ships on its own. Phase 1 alone fixes everything that is
*wrong*; the rest is what makes it look *finished*.

| # | Phase | Contents | Size |
|---|---|---|---|
| 0 | **Split the file, no behaviour change** | `TaskDetailPanel.tsx` is 2,815 lines. Move sections to `components/projects/task-card/` (`types.ts`, `useTaskCard.ts`, `TaskCardBody.tsx`, `DetailsCard.tsx`, `TimeCard.tsx`, `DescriptionSection.tsx`, `ChecklistSection.tsx`, `RecordTabs.tsx`, `ActivitySection.tsx`, `AttachmentsSection.tsx`, `TitleField.tsx`), and swap the 27-prop drilling for `card: TaskCard`. `TaskDetailPanel` keeps its path and default export, so no caller or test import changes. Gate: the existing suites green, count taken from the runner. | M, mechanical |
| 1 | **Fix what is broken on the page** | Editable title on the page (#6). Not-found and failed states (#11). The log-time hint only while open (#5). The Comments tab no longer headed "Activity". Labels visible when set (#10). | S |
| 2 | **Surfaces and frame** | White cards through an extended `CompactSection` (new `actions` slot and a `heading` title style; existing callers unchanged). Fixed 20rem sidebar, `maxWidth="wide"`, key chip, breadcrumb, header actions and `⋯`, `document.title`, page opens on Comments with `?tab=`. | M |
| 3 | **Details as a property list** | `ChipPopover variant="field"` and `multiple`, icons, status dot, avatar, priority flag, due-date row, labels row, epic row, created/updated footer. Backend `findOne` additions. | M |
| 4 | **Time card** | Log time moved in, hint arithmetic, estimate affordance, running-clock state, sparkline caption. | S |
| 5 | **Record polish** | Tabs in a card, Watch in the header (both presentations), comment avatars and relative times, "who logged" in the hour log, delete-asks-first, attachment count. | M |
| 6 | *Optional* | Read-only subtasks list when a task has any (`findOne` already returns them with status). Page skeleton. | S |

The modal gets phases 1, 3, 4 and 5 for free, because they live in the shared
body. Phase 2's frame is the page's own, and the body takes a
`presentation: 'modal' | 'page'` prop for three things only: whether cards
carry a shadow (flat inside the white modal), the grid template, and whether
a tab opens by default.

---

## Costs, honestly

- **Tests.** `TaskDetailPanel.test.tsx` is 2,022 lines and mounts the default
  export. Known rewrites:
  - the page's "goes back to the project", since Back becomes the
    breadcrumb and ⋯ → Open project;
  - the header test, since the heading now holds a textarea;
  - the label tests, since a collapsible becomes a row and a popover;
  - the log-time tests, since the "+" moves to the Time card;
  - the watch tests, since Watch moves out of the tab.

  The "three requests to open" test must stay green unchanged, and it is the
  gate for the modal. As in 3P: extract first, prove green, then change.
- **i18n.** New keys land in all nine catalogues, and `catalog.test.ts`
  fails on a missing one. They cover:
  - copy key and key-copied;
  - more actions, open project, delete from the menu;
  - created by, updated;
  - the not-found title, body and CTA, and try again;
  - the empty-state hints;
  - epic;
  - the remaining-over-time caption;
  - the log-time hint with arithmetic;
  - the shortened tab labels.

  The orphaned `cover` block can go in the same pass.
- **RTL.** `ar` and `ur` are live. Popovers and the ⋯ menu use logical
  properties; `scripts/rtl-codemod.js` fails physical utilities, even in
  comments.
- **Two-column breakpoint.** Moving from `md` to `lg` means 768–1023px
  viewports stack where they had two columns. On the page that is right,
  because the app sidebar leaves ~500px there. The modal keeps `md`.

---

## Decisions for you

1. **Page width.** Cap at 1200px and centre (recommended), or keep full
   width with only the sidebar fixed?
2. **Log time in the Time card**, for both modal and page (recommended), or
   keep it as its own section in the main column?
3. **Drop Back** in favour of the breadcrumb plus ⋯ → Open project
   (recommended), or keep it?
4. **Default tab on the page:** Comments (recommended) or Activity?
5. **Subtasks.** 3E was postponed at your request on 2026-08-03. Show a
   read-only list when a task has subtasks (recommended, phase 6), or keep
   it off?
6. **Phase 0 split** first (recommended), or restyle in place and split
   later?

## Not doing

- A separate create-task page. Create stays the modal and quick add.
- A milestone picker: there is still no list endpoint.
- `@mentions`, archive (3J), dependencies between tasks.
- Hiding Delete from people without `MANAGE_PROJECT_TASKS`. The Tasks list
  doesn't either, and the endpoint refuses. Worth doing app-wide, not here.
- Start date back on the card.

---

## What shipped, against this plan

Built on 2026-09-25 in the order of the Sequencing table, with Phase 0 as a
commit of its own, proved green before anything changed. The six decisions
were taken as recommended. Where the build departs from the text above:

- **The Time card is titled "Hours".** Its three captions are "Estimated /
  Logged / Remaining", the words the project page already uses, and the figures
  are bare. The plan kept the "(h)" captions. In the browser they wrapped onto
  a second line at the sidebar's width, and the unit is said once by the card
  title instead. `task.logged` and `task.remaining` lost their only reader and
  were removed; `task.estimate` stays, because the create forms label an input
  with it.
- **The labels row is the picker's trigger.** The mockup put the chips beside a
  dashed "+". Every other row in the list is one clickable value, and the
  labels behave the same way.
- **No `labels.edit` string.** It was added and then removed, since nothing
  needed it.
- **Menu width.** The ⋯ menu is 16rem, not 14rem. At 14rem, "Copy task key"
  plus the key truncated the key.
- **The key chip on a phone.** The 44px touch floor sits on an unstyled
  button, with the chip drawn inside it. A 44px-tall bordered box around a 12px
  key read as a text field.
- **Primitives.** `Button` gained a `tinted` variant for a pressed toggle
  (Watching) or a live action (a running clock), because a `className` cannot
  restyle `secondary`. `Tabs` gained `bordered`, so a strip that heads a card
  with nothing open does not rule a line on the card's own edge.

Verification: the full frontend suite (390 suites / 4,839 tests) passed twice,
and `project-tasks.service.spec.ts` passes 96/96. The frontend type check and
lint are clean on every changed file, and all nine catalogues are in parity.
The real page component was rendered in headless Chromium against stubbed API
responses at 360, 390, 1024, 1440 and 1920px. At each width the checks were no
horizontal scroll, and a screenshot compared against the mockup. The labels
picker, the ⋯ menu and the log form were also opened and screenshotted. It has
not been run against a real backend or on a real phone; `TODO.md` carries that.

