# Readable project URLs — design

**Date:** 2026-09-22
**Status:** Awaiting review

---

## Problem

A board and a task are the two things people in this app send each other, and
both are addressed by a raw UUID:

```
/projects/boards/2d1597c2-3c49-44c5-b88d-35a07a373cdb
/projects/tasks/a60e33e0-71e9-4527-9468-4063278ffa2e
```

Three consequences:

1. **The URLs cannot be read, quoted or typed.** A task has no name anyone can
   say out loud — there is no `ALP-14` to put in a commit message or a chat.
2. **A task opened on a board has no URL at all.** `TaskDetailPanel` opens over
   the board from local state, so "look at this card" cannot be sent.
3. **Nothing offers to share a link.** A full short-links module already exists
   (`apps/backend/src/short-links/`, `/s/[code]` in the frontend) and no project
   screen uses it.

Production is small enough that fixing the identifiers now is cheap: **7 boards,
842 tasks, 26 projects, 3 tenants.** The same change at fifty thousand tasks is
a different piece of work.

## Approach

Give boards and tasks human-readable keys, keep every key that has ever been
issued resolvable, and put a share button on the task panel.

```
/projects/boards/2d1597c2-…-373cdb   →  /b/erp71
(no URL at all)                       →  /t/ERP-14
```

### The rule that shapes everything

**A key that has been shared must keep working.** A board renamed from "ERP71"
to "Platform", or a project code changed from `PRJ-0002` to `ERP`, must not
silently break links already pasted into a chat months ago. Broken links of
this kind are never reported — the person just finds nothing and gives up.

So both keys carry history, and both resolve through it.

---

## Data model

Four schema changes. All additive; no column is dropped or retyped.

### 1. `Board.slug`

```prisma
slug String
@@unique([tenant_id, slug])
```

Derived from the name: lowercase, non-alphanumerics to `-`, collapsed, trimmed,
capped at 60 characters. A collision within the tenant appends `-2`, `-3`, …

Backfill: 7 rows. Production names slugify without collision today
(`OTB`→`otb`, `OTB tahsin`→`otb-tahsin`, `ERP71`→`erp71`, `Board 1`→`board-1`).
A board whose name yields an empty slug (punctuation only) falls back to
`board-<first 8 of id>`.

### 2. `BoardSlugHistory`

```prisma
model BoardSlugHistory {
  id         String   @id @default(uuid())
  tenant_id  String
  board_id   String
  slug       String
  created_at DateTime @default(now())

  @@unique([tenant_id, slug])
  @@index([board_id])
}
```

A rename writes the *old* slug here before taking the new one. The unique
constraint spans history, so a slug freed by a rename cannot be claimed by
another board and silently steal its links.

### 3. `ProjectTask.reference`

```prisma
reference Int
@@unique([project_id, reference])
```

Per-project, 1-based, exactly like `ProjectUserStory.reference`
(`project-stories.service.ts:251`). Taken from the highest existing reference
rather than a count, so deleting task 2 does not hand its number to the next
task written.

Backfill: 842 rows, numbered per project by `created_at` so the oldest task in
each project is 1.

The displayed key is `<project.code>-<reference>` — `ERP-14`, `D1-BR3-7`. It is
composed at read time, never stored, so it always reflects the project's current
code.

### 4. `ProjectCodeHistory`

```prisma
model ProjectCodeHistory {
  id         String   @id @default(uuid())
  tenant_id  String
  project_id String
  code       String
  created_at DateTime @default(now())

  @@unique([tenant_id, code])
  @@index([project_id])
}
```

The same guarantee for task keys. Because the key is composed from the project
code, editing a code would otherwise invalidate every `PRJ-0002-14` ever
shared. With history, `PRJ-0002-14` still resolves after the code becomes `ERP`,
and redirects to `ERP-14`.

This is the direct consequence of making codes editable, and the reason it is
in this spec rather than deferred.

---

## Resolution

One helper per entity, each trying current keys first and history second.

**Board** — `/b/<slug>`:
1. `Board where { tenant_id, slug }` → render.
2. `BoardSlugHistory where { tenant_id, slug }` → **308** to the board's current
   slug.
3. Otherwise 404.

**Task** — `/t/<code>-<reference>`:
1. Split on the last `-`; the tail must be digits. `D1-BR3-7` → code `D1-BR3`,
   reference `7`.
2. `Project where { tenant_id, code }`; on a miss, `ProjectCodeHistory`.
3. `ProjectTask where { project_id, reference }`.
4. A history hit **308**s to the current key; a current hit renders.
5. Otherwise 404.

308 rather than 302 so the redirect is cacheable and the method is preserved —
these are permanent moves.

The old UUID paths keep working, unchanged. `/projects/boards/<uuid>` and
`/projects/tasks/<uuid>` are what every existing link, bookmark and test uses,
and there is no value in breaking them to prove a point.

---

## A task open on a board

`/projects/boards/<slug>?task=<reference-or-uuid>` — exactly the pattern user
stories already use (`routes.projects.storyInProject`, read by the project page
and handed to `ProjectStoriesCard` as `openStoryId`).

The board reads the param on mount and opens `TaskDetailPanel` over the board.
Closing the panel clears the param without a navigation, so Back leaves the
board rather than stepping through every card that was opened.

`/t/<key>` resolves to the task's own page. The query form is for "look at this
card *on this board*", where the column and its neighbours are the context.

---

## Editable project codes

`CreateProjectDto` and `UpdateProjectDto` accept an optional `code`:

- `^[A-Z][A-Z0-9-]{1,11}$` — upper-case, starts with a letter, 2–12 characters.
  Rejecting lower case keeps `ERP-14` visually distinct from a board slug.

> **A code may end in a digit-only segment, and `PRJ-0002` does.** So a bare
> code and a task key are not distinguishable by shape alone: parsing
> `PRJ-0002` yields code `PRJ`, reference `2`. This is only a problem if `/t/`
> ever has to accept a bare project code, which it does not — `/t/` is a task
> route, always `<code>-<reference>`, and a project is reached at
> `/projects/<id>`. The parse is therefore defined as: split on the **last**
> `-`, require a digit-only tail, and look the code up; if no project or
> history row carries that code, 404 rather than guessing a different split.
>
> New codes *should* avoid a trailing number — `ERP` reads better than
> `ERP-01` — but forbidding it in the regex would make the existing
> `PRJ-0002` codes unrepresentable and every task in them unaddressable, which
> is a worse trade than an ambiguity no route exposes.
- Unique per tenant across **both** `Project.code` and `ProjectCodeHistory`.
- Omitted on create → the existing `PRJ-0001` generator.
- Changed on update → the old code moves to `ProjectCodeHistory` first.

`nextCode` (`projects.service.ts:54`) keeps its retry-on-unique-violation, and
now also skips codes held by history.

## Sharing

A share icon in `TaskDetailPanel`'s title bar, beside the existing actions.

The short-links API is gated on the `urlShortener` platform feature and the
`MANAGE_SHORT_LINKS` store permission (`short-links.controller.ts:68-74`), which
most users will not hold. So the button degrades instead of disappearing:

- **With both** → `POST /short-links` with the task's canonical URL and the task
  key as the label; the returned `/s/<code>` goes to the clipboard.
- **Without** → the full canonical URL goes to the clipboard.

Either way the button is present, the clipboard ends up with a working link, and
a toast says which kind it was. A failed shorten falls back to the full URL
rather than reporting an error — the person wanted a link, not a short link.

---

## Testing

Unit, no live data:

- `board-slug.spec.ts` — slugify (case, punctuation, Bengali, empty-name
  fallback), collision suffixes, 60-char cap.
- `task-key.spec.ts` — compose and parse; **`D1-BR3-7` splits to `D1-BR3` + 7**,
  not `D1` + `BR3-7`; **`PRJ-0002-14` splits to `PRJ-0002` + 14**, the case a
  naive first-`-` split gets wrong; rejects a missing or non-numeric tail; a
  key whose code matches no project or history row 404s rather than retrying a
  different split.
- `board-slug-history.spec.ts` — a rename writes history; a freed slug cannot be
  claimed by another board; history resolves to a 308.
- `project-code.spec.ts` — validation; a code change writes history; a code held
  only by history is refused to a new project.
- `task-reference.spec.ts` — per-project numbering from the highest, not the
  count; concurrent creates do not collide.
- `TaskDetailPanel.test.tsx` — share copies a short link when permitted, the
  full URL when not, and the full URL when shortening fails.
- Board page — `?task=` opens the panel; closing clears the param.

Backfill correctness is asserted in the migration's own test against a seeded
copy, not in production.

## Migration and rollout

Two migrations, in order:

1. `add_board_slug` — column, history table, backfill, unique index **last**
   (a unique index added before the backfill fails on the second row).
2. `add_task_reference` — column, `ProjectCodeHistory`, backfill numbering per
   project by `created_at`, unique index last.

Both are additive and safe to run before the code that reads them deploys.
Reversing them means dropping columns that nothing else references.

## Out of scope

- **Renaming a board does not change its slug automatically.** The slug is
  derived at creation and edited deliberately, with history covering the change.
  Auto-following a rename would churn URLs on every typo fix.
- **No slug for projects themselves.** `/projects/<uuid>` stays; the project code
  already serves as its readable key inside task keys.
- **No short link on the board.** The board URL is now short enough to paste.

## Open question

`urlShortener` is not in `packages/shared-types/index.ts` alongside the other
platform feature keys — it is read by `@RequiresFeature('urlShortener')` and must
live in the platform-settings catalogue. The share button needs to know whether
it is on for the tenant *before* deciding which clipboard path to take;
confirming how the frontend reads that flag is the first implementation step,
and the fallback path means a wrong guess degrades to copying the full URL
rather than failing.
