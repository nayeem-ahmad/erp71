# Readable Project URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give boards and tasks human-readable URLs that keep working after a rename, and a share button that produces a link.

**Architecture:** Four additive schema changes (`Board.slug`, `BoardSlugHistory`, `ProjectTask.reference`, `ProjectCodeHistory`), pure-function key helpers, resolution folded into the two existing lookup chokepoints (`assertBoard`, the task service), and new short routes that 308 from a retired key to the current one. The old UUID routes keep working untouched.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Next.js 15 App Router, Jest

**Spec:** `docs/superpowers/specs/2026-09-22-readable-project-urls-design.md`

## Global Constraints

- **Both migrations add the unique index LAST**, after the backfill. A unique index created before the backfill fails on the second row.
- Migrations are hand-written SQL under `packages/database/prisma/migrations/<timestamp>_<name>/migration.sql`, with a comment block explaining *why* — match the style of `20260920120000_activation_requests`.
- Use `ADD COLUMN IF NOT EXISTS` so a re-run is safe.
- Every business query is scoped to `tenant_id` (`TenantInterceptor` convention).
- Key helpers are **pure functions** — no Prisma, no I/O — so they are fully testable.
- Old UUID routes (`/projects/boards/<uuid>`, `/projects/tasks/<uuid>`) must keep working. Do not change or remove them.
- A retired key redirects with **308**, not 302 — permanent, cacheable, method-preserving.
- Frontend follows `docs/ui-design-guidelines.md`: `blue-600` accent, `text-sm`/`text-xs` body, `min-h-touch` on controls, toasts via the global `Toaster`.
- Backend tests: `cd apps/backend && npx jest <pattern>`. Frontend: `cd apps/frontend && npx jest --testPathPatterns "<pattern>"` (the parens in `(app)` break a bare path pattern).
- **After changing `schema.prisma`, run `npx prisma generate --schema packages/database/prisma/schema.prisma`** or the build fails against a stale client.
- Commit after each task. Branch is `dev` — never commit to `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/projects/url-keys/board-slug.ts` | **new** — slugify, collision suffixing |
| `apps/backend/src/projects/url-keys/task-key.ts` | **new** — compose/parse `<code>-<n>` |
| `apps/backend/src/projects/url-keys/project-code.ts` | **new** — code validation |
| `packages/database/prisma/migrations/<ts>_add_board_slug/migration.sql` | **new** — column, history table, backfill |
| `packages/database/prisma/migrations/<ts>_add_task_reference/migration.sql` | **new** — column, history table, backfill |
| `packages/database/prisma/schema.prisma` | **modify** — four additions |
| `apps/backend/src/projects/boards.service.ts` | **modify** — `assertBoard` resolves a slug; rename writes history |
| `apps/backend/src/projects/project-tasks.service.ts` | **modify** — assign `reference` on create; resolve a key |
| `apps/backend/src/projects/projects.service.ts` | **modify** — accept/validate a code; write history on change |
| `apps/backend/src/projects/project.dto.ts` | **modify** — optional `code` |
| `apps/backend/src/projects/boards.controller.ts` | **modify** — `GET resolve/:key` |
| `apps/backend/src/projects/project-tasks.controller.ts` | **modify** — `GET resolve/:key` |
| `apps/frontend/src/app/b/[slug]/page.tsx` | **new** — board short route |
| `apps/frontend/src/app/t/[key]/page.tsx` | **new** — task short route |
| `apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx` | **modify** — read `?task=` |
| `apps/frontend/src/components/projects/TaskDetailPanel.tsx` | **modify** — share button |
| `apps/frontend/src/lib/routes.ts` | **modify** — new helpers |

---

## Task 1: Key helper functions

Pure functions, no database. Everything else builds on these.

**Files:**
- Create: `apps/backend/src/projects/url-keys/board-slug.ts`
- Create: `apps/backend/src/projects/url-keys/task-key.ts`
- Create: `apps/backend/src/projects/url-keys/project-code.ts`
- Test: `apps/backend/src/projects/url-keys/board-slug.spec.ts`
- Test: `apps/backend/src/projects/url-keys/task-key.spec.ts`
- Test: `apps/backend/src/projects/url-keys/project-code.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `slugify(name: string): string`
  - `uniqueSlug(base: string, taken: Set<string>): string`
  - `slugFallback(id: string): string`
  - `composeTaskKey(code: string, reference: number): string`
  - `parseTaskKey(key: string): { code: string; reference: number } | null`
  - `isValidProjectCode(code: string): boolean`
  - `PROJECT_CODE_PATTERN: RegExp`

- [ ] **Step 1: Write the failing tests**

`board-slug.spec.ts`:

```ts
import { slugFallback, slugify, uniqueSlug } from './board-slug';

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('OTB tahsin')).toBe('otb-tahsin');
    });
    it('keeps digits', () => {
        expect(slugify('ERP71')).toBe('erp71');
    });
    it('collapses runs of punctuation into one hyphen', () => {
        expect(slugify('Release 4 -- final!!')).toBe('release-4-final');
    });
    it('trims leading and trailing hyphens', () => {
        expect(slugify('  --Board 1--  ')).toBe('board-1');
    });
    it('keeps Bengali letters rather than dropping them', () => {
        // A tenant naming a board in Bengali must not get an empty slug.
        expect(slugify('বোর্ড ১')).toBe('বোর্ড-১');
    });
    it('caps at 60 characters without a trailing hyphen', () => {
        const slug = slugify('a'.repeat(80));
        expect(slug).toHaveLength(60);
        expect(slug.endsWith('-')).toBe(false);
    });
    it('returns empty for a name with nothing sluggable', () => {
        expect(slugify('!!!')).toBe('');
    });
});

describe('uniqueSlug', () => {
    it('returns the base when it is free', () => {
        expect(uniqueSlug('otb', new Set())).toBe('otb');
    });
    it('suffixes -2 on the first collision', () => {
        expect(uniqueSlug('otb', new Set(['otb']))).toBe('otb-2');
    });
    it('keeps counting past an existing suffix', () => {
        expect(uniqueSlug('otb', new Set(['otb', 'otb-2']))).toBe('otb-3');
    });
});

describe('slugFallback', () => {
    it('builds a slug from the id when the name yields nothing', () => {
        expect(slugFallback('2d1597c2-3c49-44c5-b88d-35a07a373cdb')).toBe('board-2d1597c2');
    });
});
```

`task-key.spec.ts`:

```ts
import { composeTaskKey, parseTaskKey } from './task-key';

describe('composeTaskKey', () => {
    it('joins the project code and the reference', () => {
        expect(composeTaskKey('ERP', 14)).toBe('ERP-14');
    });
    it('keeps a hyphenated code intact', () => {
        expect(composeTaskKey('D1-BR3', 7)).toBe('D1-BR3-7');
    });
});

describe('parseTaskKey', () => {
    it('splits on the LAST hyphen, not the first', () => {
        // The bug a naive split introduces: D1 + "BR3-7".
        expect(parseTaskKey('D1-BR3-7')).toEqual({ code: 'D1-BR3', reference: 7 });
    });

    it('handles a code that itself ends in digits', () => {
        // 737 of production's 842 tasks live in PRJ-0002.
        expect(parseTaskKey('PRJ-0002-14')).toEqual({ code: 'PRJ-0002', reference: 14 });
    });

    it('parses a simple code', () => {
        expect(parseTaskKey('ERP-14')).toEqual({ code: 'ERP', reference: 14 });
    });

    it('rejects a key with no reference', () => {
        expect(parseTaskKey('ERP')).toBeNull();
    });

    it('rejects a non-numeric tail', () => {
        expect(parseTaskKey('ERP-abc')).toBeNull();
    });

    it('rejects a zero or negative reference', () => {
        expect(parseTaskKey('ERP-0')).toBeNull();
        expect(parseTaskKey('ERP--1')).toBeNull();
    });

    it('rejects an empty code', () => {
        expect(parseTaskKey('-14')).toBeNull();
    });

    it('round-trips every real production code', () => {
        for (const code of ['PRJ-0002', 'PRJ-0004', 'D1-BR3', 'D1-DIGI', 'D2-BR3', 'ERP']) {
            expect(parseTaskKey(composeTaskKey(code, 14))).toEqual({ code, reference: 14 });
        }
    });
});
```

`project-code.spec.ts`:

```ts
import { isValidProjectCode } from './project-code';

describe('isValidProjectCode', () => {
    it.each(['ERP', 'D1-BR3', 'PRJ-0002', 'AB'])('accepts %s', (code) => {
        expect(isValidProjectCode(code)).toBe(true);
    });

    it('rejects lower case, so a code cannot be confused with a board slug', () => {
        expect(isValidProjectCode('erp')).toBe(false);
    });

    it('rejects a code starting with a digit', () => {
        expect(isValidProjectCode('1ERP')).toBe(false);
    });

    it('rejects one character', () => {
        expect(isValidProjectCode('E')).toBe(false);
    });

    it('rejects more than twelve characters', () => {
        expect(isValidProjectCode('A'.repeat(13))).toBe(false);
    });

    it('rejects spaces and punctuation other than hyphen', () => {
        expect(isValidProjectCode('ERP 1')).toBe(false);
        expect(isValidProjectCode('ERP_1')).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && npx jest src/projects/url-keys`
Expected: FAIL — `Cannot find module './board-slug'`

- [ ] **Step 3: Write `board-slug.ts`**

```ts
/**
 * A board's readable key.
 *
 * Board names are deliberately not unique (a soft-deleted board would hold its
 * name hostage against a new one — see the comment on the model), so a slug is
 * derived from the name and then disambiguated rather than assumed unique.
 */

const MAX_LENGTH = 60;

/** Lowercase, non-alphanumerics to hyphens, collapsed, trimmed, capped. */
export function slugify(name: string): string {
    return (name ?? '')
        .normalize('NFC')
        .toLowerCase()
        // `\p{L}` and `\p{N}` keep every script, not only ASCII: a board named
        // in Bengali must not slugify to nothing. `\p{M}` keeps the combining
        // marks that Bengali vowel signs are made of — without it "বোর্ড"
        // loses its vowels and two different names collapse together.
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, MAX_LENGTH)
        .replace(/-$/, '');
}

/** `otb`, then `otb-2`, `otb-3`, … against the slugs already taken. */
export function uniqueSlug(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

/** For a name that yields no slug at all — punctuation only, say. */
export function slugFallback(id: string): string {
    return `board-${id.slice(0, 8)}`;
}
```

- [ ] **Step 4: Write `task-key.ts`**

```ts
/**
 * A task's readable key: `<project code>-<reference>`.
 *
 * Composed at read time rather than stored, so it always reflects the project's
 * current code — and so a code change does not have to rewrite every task row.
 */

export function composeTaskKey(code: string, reference: number): string {
    return `${code}-${reference}`;
}

/**
 * Splits on the **last** hyphen, because a project code may contain hyphens
 * (`D1-BR3`) and may itself end in a digit-only segment (`PRJ-0002`, which
 * holds 737 of production's 842 tasks). A first-hyphen split reads `D1-BR3-7`
 * as project `D1`, and a shape-based rule cannot separate `PRJ-0002` from a
 * key — so the tail is taken as the reference and the head is looked up as a
 * code. A head that matches no project simply 404s; it is never re-split.
 */
export function parseTaskKey(key: string): { code: string; reference: number } | null {
    const at = (key ?? '').lastIndexOf('-');
    if (at <= 0) return null;

    const code = key.slice(0, at);
    const tail = key.slice(at + 1);
    if (!code || !/^\d+$/.test(tail)) return null;

    const reference = Number(tail);
    if (!Number.isSafeInteger(reference) || reference < 1) return null;
    return { code, reference };
}
```

- [ ] **Step 5: Write `project-code.ts`**

```ts
/**
 * Upper-case so a code is never mistaken for a board slug, 2–12 characters,
 * starting with a letter.
 *
 * A trailing digit-only segment is allowed, because `PRJ-0002` already exists
 * and forbidding it would make every task in those projects unaddressable. See
 * `parseTaskKey` for why that costs nothing.
 */
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,11}$/;

export function isValidProjectCode(code: string): boolean {
    return PROJECT_CODE_PATTERN.test(code ?? '');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/backend && npx jest src/projects/url-keys`
Expected: PASS — all three files

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/projects/url-keys/
git commit -m "feat(projects): key helpers for readable board and task URLs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Board slug schema and backfill

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (the `Board` model)
- Create: `packages/database/prisma/migrations/20260922120000_add_board_slug/migration.sql`

**Interfaces:**
- Consumes: `slugify` semantics (the SQL reimplements them; Task 5 asserts they agree)
- Produces: `Board.slug`, `BoardSlugHistory`

- [ ] **Step 1: Add to `schema.prisma`**

In `model Board`, after `name`:

```prisma
  /// The board's readable URL key. Derived from the name at creation and then
  /// edited deliberately — it does not follow a rename, because churning a URL
  /// on every typo fix is worse than a slug that has drifted from the name.
  slug        String
```

and in the index block:

```prisma
  @@unique([tenant_id, slug])
```

Then the history table, after `model Board`:

```prisma
/// Every slug a board has ever answered to.
///
/// A link pasted into a chat three months ago has to keep working, and a
/// broken one of these is never reported — the person finds nothing and gives
/// up. The unique spans history as well as live slugs, so a slug freed by a
/// rename cannot be claimed by another board and silently steal its links.
model BoardSlugHistory {
  id         String   @id @default(uuid())
  tenant_id  String
  board_id   String
  slug       String
  created_at DateTime @default(now())

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  board  Board  @relation(fields: [board_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, slug])
  @@index([board_id])
  @@map("board_slug_history")
}
```

Add the back-relations: `slugHistory BoardSlugHistory[]` on `Board`, and `boardSlugHistory BoardSlugHistory[]` on `Tenant`.

- [ ] **Step 2: Write the migration**

`packages/database/prisma/migrations/20260922120000_add_board_slug/migration.sql`:

```sql
-- A board is one of the two things people in this app send each other, and it
-- was addressed by a raw UUID. This gives it a readable key.
--
-- The column is added nullable, backfilled, and only then made NOT NULL with a
-- unique index: a unique index created before the backfill fails on the second
-- row, and every existing board has no slug at all.
--
-- Slugs are derived the same way the application derives them (lowercase,
-- non-alphanumerics to hyphens, collapsed, trimmed, capped at 60), with the
-- row number appended inside a tenant when two names collide. Production has 7
-- boards across 3 tenants and no collisions today, but a tenant with "Board 1"
-- and "board-1" would produce one, and a migration that fails halfway is worse
-- than one that disambiguates.

ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "slug" TEXT;

WITH slugged AS (
    SELECT
        id,
        tenant_id,
        NULLIF(
            TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9ঀ-৿]+', '-', 'g')),
            ''
        ) AS base
    FROM "boards"
),
resolved AS (
    SELECT
        id,
        COALESCE(base, 'board-' || SUBSTRING(id::text, 1, 8)) AS base,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, COALESCE(base, 'board-' || SUBSTRING(id::text, 1, 8))
            ORDER BY id
        ) AS n
    FROM slugged
)
UPDATE "boards" b
SET "slug" = CASE WHEN r.n = 1 THEN LEFT(r.base, 60) ELSE LEFT(r.base, 57) || '-' || r.n END
FROM resolved r
WHERE b.id = r.id AND b."slug" IS NULL;

ALTER TABLE "boards" ALTER COLUMN "slug" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "board_slug_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "board_slug_history_pkey" PRIMARY KEY ("id")
);

-- Last, per the note above.
CREATE UNIQUE INDEX IF NOT EXISTS "boards_tenant_id_slug_key" ON "boards"("tenant_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "board_slug_history_tenant_id_slug_key" ON "board_slug_history"("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "board_slug_history_board_id_idx" ON "board_slug_history"("board_id");

ALTER TABLE "board_slug_history"
    ADD CONSTRAINT "board_slug_history_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_slug_history"
    ADD CONSTRAINT "board_slug_history_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the client and check the schema is valid**

Run:
```bash
npx prisma validate --schema packages/database/prisma/schema.prisma
npx prisma generate --schema packages/database/prisma/schema.prisma
```
Expected: both succeed; `grep -c "BoardSlugHistory" node_modules/.prisma/client/index.d.ts` is non-zero.

- [ ] **Step 4: Verify the backfill SQL against production's real names**

The migration cannot be run against production from here, so check the slug
expression alone returns what Task 1's `slugify` would, for the seven real
names. Run against any reachable Postgres:

```sql
SELECT name, TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9ঀ-৿]+', '-', 'g'))
FROM (VALUES ('OTB'), ('OTB tahsin'), ('Board 1'), ('ERP71'), ('Jobxprss'), ('Kraftize'), ('MLB')) AS t(name);
```

Expected: `otb`, `otb-tahsin`, `board-1`, `erp71`, `jobxprss`, `kraftize`, `mlb`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260922120000_add_board_slug/
git commit -m "feat(db): board slugs and their history

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Task reference and project code history schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`ProjectTask`, plus a new model)
- Create: `packages/database/prisma/migrations/20260922130000_add_task_reference/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `ProjectTask.reference`, `ProjectCodeHistory`

- [ ] **Step 1: Add to `schema.prisma`**

In `model ProjectTask`:

```prisma
  /// 1-based within a project, like ProjectUserStory.reference. The displayed
  /// key is `<project.code>-<reference>`, composed at read time so it follows
  /// the project's current code.
  reference            Int
```

and in the index block: `@@unique([project_id, reference])`

Then:

```prisma
/// Every code a project has ever answered to.
///
/// A task's key is composed from its project's code, so editing a code would
/// invalidate every `PRJ-0002-14` ever pasted anywhere. This keeps the old key
/// resolving, and redirecting to the new one.
model ProjectCodeHistory {
  id         String   @id @default(uuid())
  tenant_id  String
  project_id String
  code       String
  created_at DateTime @default(now())

  tenant  Tenant  @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  project Project @relation(fields: [project_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, code])
  @@index([project_id])
  @@map("project_code_history")
}
```

Add back-relations `codeHistory ProjectCodeHistory[]` on `Project` and `projectCodeHistory ProjectCodeHistory[]` on `Tenant`.

- [ ] **Step 2: Write the migration**

`packages/database/prisma/migrations/20260922130000_add_task_reference/migration.sql`:

```sql
-- Tasks had no number, so a task had no name anyone could say out loud and no
-- URL worth pasting. This numbers them per project, 1-based, the way user
-- stories are already numbered.
--
-- Backfilled in `created_at` order so the oldest task in each project is 1,
-- which is the numbering somebody reading the project would expect. Ties on
-- `created_at` (a bulk import) break on `id` so the result is deterministic.
--
-- Unique index last, after the backfill — before it, the second row fails.

ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "reference" INTEGER;

WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
    FROM "project_tasks"
)
UPDATE "project_tasks" t
SET "reference" = numbered.n
FROM numbered
WHERE t.id = numbered.id AND t."reference" IS NULL;

ALTER TABLE "project_tasks" ALTER COLUMN "reference" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "project_code_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_code_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_tasks_project_id_reference_key" ON "project_tasks"("project_id", "reference");
CREATE UNIQUE INDEX IF NOT EXISTS "project_code_history_tenant_id_code_key" ON "project_code_history"("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "project_code_history_project_id_idx" ON "project_code_history"("project_id");

ALTER TABLE "project_code_history"
    ADD CONSTRAINT "project_code_history_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_code_history"
    ADD CONSTRAINT "project_code_history_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate and regenerate**

Run:
```bash
npx prisma validate --schema packages/database/prisma/schema.prisma
npx prisma generate --schema packages/database/prisma/schema.prisma
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260922130000_add_task_reference/
git commit -m "feat(db): per-project task references and project code history

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Boards service — slug assignment and resolution

**Files:**
- Modify: `apps/backend/src/projects/boards.service.ts` (`assertBoard` at :67, `create`, `update`)
- Test: `apps/backend/src/projects/boards-slug.service.spec.ts`

**Interfaces:**
- Consumes: `slugify`, `uniqueSlug`, `slugFallback` from `./url-keys/board-slug`
- Produces: `BoardsService.assertBoard` accepting an id *or* a slug; `BoardsService.resolveSlug(tenantId, slug): Promise<{ boardId: string; currentSlug: string; moved: boolean } | null>`

- [ ] **Step 1: Write the failing test**

```ts
import { BoardsService } from './boards.service';

function makeDb() {
    return {
        board: {
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
        },
        boardSlugHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
        },
        $transaction: jest.fn((fn: never) => (typeof fn === 'function' ? (fn as never) : fn)),
    };
}

describe('board slug resolution', () => {
    let db: ReturnType<typeof makeDb>;
    let service: BoardsService;

    beforeEach(() => {
        db = makeDb();
        service = new BoardsService(db as never, {} as never, {} as never);
    });

    it('resolves a current slug without redirecting', async () => {
        db.board.findFirst.mockResolvedValue({ id: 'b1', slug: 'erp71' });

        expect(await service.resolveSlug('t1', 'erp71')).toEqual({
            boardId: 'b1',
            currentSlug: 'erp71',
            moved: false,
        });
    });

    it('resolves a retired slug and reports the move', async () => {
        db.board.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'b1', slug: 'platform' });
        db.boardSlugHistory.findFirst.mockResolvedValue({ board_id: 'b1' });

        expect(await service.resolveSlug('t1', 'erp71')).toEqual({
            boardId: 'b1',
            currentSlug: 'platform',
            moved: true,
        });
    });

    it('returns null for a slug nobody has held', async () => {
        db.board.findFirst.mockResolvedValue(null);
        expect(await service.resolveSlug('t1', 'nope')).toBeNull();
    });

    it('scopes both lookups to the tenant', async () => {
        db.board.findFirst.mockResolvedValue({ id: 'b1', slug: 'erp71' });
        await service.resolveSlug('t1', 'erp71');
        expect(db.board.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ tenant_id: 't1' }) }),
        );
    });
});

describe('board slug assignment', () => {
    let db: ReturnType<typeof makeDb>;
    let service: BoardsService;

    beforeEach(() => {
        db = makeDb();
        service = new BoardsService(db as never, {} as never, {} as never);
    });

    it('derives a slug from the name on create', async () => {
        expect(await service.nextSlug('t1', 'OTB tahsin')).toBe('otb-tahsin');
    });

    it('disambiguates against a slug already taken', async () => {
        db.board.findMany.mockResolvedValue([{ slug: 'otb' }]);
        expect(await service.nextSlug('t1', 'OTB')).toBe('otb-2');
    });

    it('disambiguates against a slug held only by history', async () => {
        // A freed slug must not be reusable, or it steals the old board's links.
        db.boardSlugHistory.findMany.mockResolvedValue([{ slug: 'otb' }]);
        expect(await service.nextSlug('t1', 'OTB')).toBe('otb-2');
    });

    it('falls back to the id when a name yields no slug', async () => {
        expect(await service.nextSlug('t1', '!!!', 'aabbccdd-1111-2222-3333-444455556666')).toBe('board-aabbccdd');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/projects/boards-slug.service`
Expected: FAIL — `resolveSlug is not a function`

- [ ] **Step 3: Implement**

Add to `BoardsService`:

```ts
/**
 * A board by slug, or by a slug it used to have.
 *
 * `moved` is what the caller turns into a 308: a link that still names the old
 * slug keeps working, and the browser learns the new one.
 */
async resolveSlug(tenantId: string, slug: string) {
    const live = await this.db.board.findFirst({
        where: { tenant_id: tenantId, slug, deleted_at: null },
        select: { id: true, slug: true },
    });
    if (live) return { boardId: live.id, currentSlug: live.slug, moved: false };

    const past = await this.db.boardSlugHistory.findFirst({
        where: { tenant_id: tenantId, slug },
        select: { board_id: true },
    });
    if (!past) return null;

    const board = await this.db.board.findFirst({
        where: { id: past.board_id, tenant_id: tenantId, deleted_at: null },
        select: { id: true, slug: true },
    });
    if (!board) return null;
    return { boardId: board.id, currentSlug: board.slug, moved: true };
}

/**
 * A free slug for a new board. Checked against history as well as live
 * boards: a slug freed by a rename must not be handed to a different board,
 * or every link to the first one silently opens the second.
 */
async nextSlug(tenantId: string, name: string, boardId?: string): Promise<string> {
    const base = slugify(name) || slugFallback(boardId ?? randomUUID());
    const [live, past] = await Promise.all([
        this.db.board.findMany({ where: { tenant_id: tenantId }, select: { slug: true } }),
        this.db.boardSlugHistory.findMany({ where: { tenant_id: tenantId }, select: { slug: true } }),
    ]);
    const taken = new Set([...live.map((b) => b.slug), ...past.map((h) => h.slug)]);
    return uniqueSlug(base, taken);
}
```

Then:
- `assertBoard(tenantId, idOrSlug)` — try `{ id: idOrSlug }` first, then `{ slug: idOrSlug }`, both scoped to the tenant and `deleted_at: null`. A UUID and a slug cannot collide (a slug is lowercase with no UUID shape), so order does not matter for correctness.
- `create` — call `nextSlug` and store it.
- `update` — when the caller supplies a new slug, write the old one to `boardSlugHistory` inside the same transaction, then take the new one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/projects/boards-slug.service`
Expected: PASS

- [ ] **Step 5: Run the existing board tests for regressions**

Run: `cd apps/backend && npx jest src/projects/boards`
Expected: PASS — the existing suites still green

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/boards.service.ts apps/backend/src/projects/boards-slug.service.spec.ts
git commit -m "feat(projects): resolve a board by slug, and by a slug it used to have

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Task references and key resolution

**Files:**
- Modify: `apps/backend/src/projects/project-tasks.service.ts`
- Test: `apps/backend/src/projects/project-task-key.service.spec.ts`

**Interfaces:**
- Consumes: `composeTaskKey`, `parseTaskKey` from `./url-keys/task-key`
- Produces: `ProjectTasksService.nextReference(projectId): Promise<number>`; `ProjectTasksService.resolveTaskKey(tenantId, key): Promise<{ taskId: string; currentKey: string; moved: boolean } | null>`

- [ ] **Step 1: Write the failing test**

```ts
describe('task reference assignment', () => {
    it('takes the next number from the highest, not from a count', async () => {
        // Deleting task 2 must not hand its number to the next task written —
        // two tasks called ERP-2 would make every older note about one wrong.
        db.projectTask.findFirst.mockResolvedValue({ reference: 7 });
        expect(await service.nextReference('p1')).toBe(8);
    });

    it('starts at 1 in an empty project', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);
        expect(await service.nextReference('p1')).toBe(1);
    });
});

describe('task key resolution', () => {
    it('resolves a current key', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'ERP' });
        db.projectTask.findFirst.mockResolvedValue({ id: 't1', reference: 14 });

        expect(await service.resolveTaskKey('tenant1', 'ERP-14')).toEqual({
            taskId: 't1',
            currentKey: 'ERP-14',
            moved: false,
        });
    });

    it('resolves a key naming a retired project code and reports the move', async () => {
        db.project.findFirst.mockResolvedValue(null);
        db.projectCodeHistory.findFirst.mockResolvedValue({ project_id: 'p1' });
        db.project.findUnique.mockResolvedValue({ id: 'p1', code: 'ERP' });
        db.projectTask.findFirst.mockResolvedValue({ id: 't1', reference: 14 });

        expect(await service.resolveTaskKey('tenant1', 'PRJ-0002-14')).toEqual({
            taskId: 't1',
            currentKey: 'ERP-14',
            moved: true,
        });
    });

    it('returns null for an unparseable key', async () => {
        expect(await service.resolveTaskKey('tenant1', 'nonsense')).toBeNull();
        expect(db.project.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when the code matches nothing, rather than re-splitting', async () => {
        db.project.findFirst.mockResolvedValue(null);
        db.projectCodeHistory.findFirst.mockResolvedValue(null);
        expect(await service.resolveTaskKey('tenant1', 'D1-BR3-7')).toBeNull();
    });

    it('returns null when the project exists but the reference does not', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'ERP' });
        db.projectTask.findFirst.mockResolvedValue(null);
        expect(await service.resolveTaskKey('tenant1', 'ERP-999')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/projects/project-task-key.service`
Expected: FAIL — `resolveTaskKey is not a function`

- [ ] **Step 3: Implement**

```ts
/**
 * `ERP-1`, `ERP-2`, … within one project. Taken from the highest reference
 * rather than a count so deleting ERP-2 does not hand its number to the next
 * task written — the same rule user stories follow, for the same reason.
 */
private async nextReference(projectId: string): Promise<number> {
    const last = await this.db.projectTask.findFirst({
        where: { project_id: projectId },
        orderBy: { reference: 'desc' },
        select: { reference: true },
    });
    return (last?.reference ?? 0) + 1;
}

/** A task by `<code>-<reference>`, or by a code the project used to have. */
async resolveTaskKey(tenantId: string, key: string) {
    const parsed = parseTaskKey(key);
    if (!parsed) return null;

    let project = await this.db.project.findFirst({
        where: { tenant_id: tenantId, code: parsed.code, deleted_at: null },
        select: { id: true, code: true },
    });
    let moved = false;

    if (!project) {
        const past = await this.db.projectCodeHistory.findFirst({
            where: { tenant_id: tenantId, code: parsed.code },
            select: { project_id: true },
        });
        if (!past) return null;
        project = await this.db.project.findUnique({
            where: { id: past.project_id },
            select: { id: true, code: true },
        });
        if (!project) return null;
        moved = true;
    }

    const task = await this.db.projectTask.findFirst({
        where: { project_id: project.id, reference: parsed.reference, deleted_at: null },
        select: { id: true, reference: true },
    });
    if (!task) return null;

    return {
        taskId: task.id,
        currentKey: composeTaskKey(project.code, task.reference),
        moved,
    };
}
```

Then, in `create`, assign `reference: await this.nextReference(projectId)`. Wrap the create in the existing retry-on-unique-violation pattern (`projects.service.ts:54` does the same for codes) so two concurrent creates cannot take the same number.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/projects/project-task-key.service`
Expected: PASS

- [ ] **Step 5: Run the task suites for regressions**

Run: `cd apps/backend && npx jest src/projects/project-task`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/project-tasks.service.ts apps/backend/src/projects/project-task-key.service.spec.ts
git commit -m "feat(projects): number tasks per project and resolve them by key

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Editable project codes

**Files:**
- Modify: `apps/backend/src/projects/project.dto.ts` (`CreateProjectDto` at :110, `UpdateProjectDto` at :169)
- Modify: `apps/backend/src/projects/projects.service.ts` (`nextCode` at :54, `create`, `update`)
- Test: `apps/backend/src/projects/project-code.service.spec.ts`

**Interfaces:**
- Consumes: `isValidProjectCode`, `PROJECT_CODE_PATTERN` from `./url-keys/project-code`
- Produces: `CreateProjectDto.code?: string`; history written on change

- [ ] **Step 1: Write the failing test**

```ts
describe('project code editing', () => {
    it('accepts a valid code on create', async () => {
        db.project.findFirst.mockResolvedValue(null);
        await service.create(viewer, { name: 'ERP', code: 'ERP' } as never);
        expect(db.project.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ code: 'ERP' }) }),
        );
    });

    it('generates a code when none is given', async () => {
        db.project.count.mockResolvedValue(1);
        db.project.findFirst.mockResolvedValue(null);
        await service.create(viewer, { name: 'Thing' } as never);
        expect(db.project.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ code: 'PRJ-0002' }) }),
        );
    });

    it('refuses a code another project holds', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'other' });
        await expect(service.create(viewer, { name: 'X', code: 'ERP' } as never)).rejects.toThrow(/already/i);
    });

    it('refuses a code held only by history, so old task keys keep pointing at one project', async () => {
        db.project.findFirst.mockResolvedValue(null);
        db.projectCodeHistory.findFirst.mockResolvedValue({ project_id: 'other' });
        await expect(service.create(viewer, { name: 'X', code: 'PRJ-0002' } as never)).rejects.toThrow(/already/i);
    });

    it('writes the old code to history when the code changes', async () => {
        db.project.findUnique.mockResolvedValue({ id: 'p1', code: 'PRJ-0002', tenant_id: 't1' });
        db.project.findFirst.mockResolvedValue(null);
        db.projectCodeHistory.findFirst.mockResolvedValue(null);

        await service.update(viewer, 'p1', { name: 'ERP', code: 'ERP' } as never);

        expect(db.projectCodeHistory.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ code: 'PRJ-0002', project_id: 'p1' }) }),
        );
    });

    it('writes no history when the code is unchanged', async () => {
        db.project.findUnique.mockResolvedValue({ id: 'p1', code: 'ERP', tenant_id: 't1' });
        await service.update(viewer, 'p1', { name: 'Renamed', code: 'ERP' } as never);
        expect(db.projectCodeHistory.create).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/projects/project-code.service`
Expected: FAIL

- [ ] **Step 3: Add `code` to the DTO**

In `CreateProjectDto`:

```ts
    /**
     * The project's short key, used in task keys like `ERP-14`. Generated as
     * `PRJ-0001` when omitted.
     */
    @IsOptional()
    @IsString()
    @Matches(PROJECT_CODE_PATTERN, {
        message: 'code must be 2–12 characters, upper-case, starting with a letter (A–Z, 0–9 and - only)',
    })
    code?: string;
```

- [ ] **Step 4: Implement the service changes**

- `create` — when `dto.code` is given, check it against both `Project` and `ProjectCodeHistory` for the tenant and throw `ConflictException('That project code is already in use')` on a hit; otherwise `nextCode`.
- `nextCode` — also skip codes held by history, so a generated code cannot collide with a retired one.
- `update` — when `dto.code` differs from the current code, validate it the same way, then inside one `$transaction`: write the old code to `ProjectCodeHistory`, then update the project.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/projects/project-code.service`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/project.dto.ts apps/backend/src/projects/projects.service.ts apps/backend/src/projects/project-code.service.spec.ts
git commit -m "feat(projects): let a project code be chosen and changed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Resolve endpoints

**Files:**
- Modify: `apps/backend/src/projects/boards.controller.ts` (after `@Get(':id')` at :58)
- Modify: `apps/backend/src/projects/project-tasks.controller.ts`
- Test: `apps/backend/src/projects/url-resolve.controller.spec.ts`

**Interfaces:**
- Consumes: `BoardsService.resolveSlug`, `ProjectTasksService.resolveTaskKey`
- Produces: `GET /projects/boards/resolve/:slug`, `GET /projects/tasks/resolve/:key`, both returning `{ id, currentKey, moved }`

> **Route order matters.** `resolve/:slug` must be declared **before** `@Get(':id')`, or Nest reads `/resolve/erp71` as an id of `resolve`. `project-tasks.controller.ts:72` already carries a comment about exactly this hazard for its import route — follow it.

- [ ] **Step 1: Write the failing test**

```ts
describe('resolve endpoints', () => {
    it('declares resolve before the :id route', () => {
        // Guarding the hazard directly: if :id were first, this call would
        // reach findOne with id="resolve".
        const spy = jest.spyOn(boards, 'resolveSlug').mockResolvedValue({
            boardId: 'b1', currentSlug: 'erp71', moved: false,
        });
        controller.resolveBoard(tenant, 'erp71');
        expect(spy).toHaveBeenCalledWith('t1', 'erp71');
    });

    it('reports a move so the caller can redirect', async () => {
        jest.spyOn(boards, 'resolveSlug').mockResolvedValue({
            boardId: 'b1', currentSlug: 'platform', moved: true,
        });
        expect(await controller.resolveBoard(tenant, 'erp71')).toEqual({
            id: 'b1', currentKey: 'platform', moved: true,
        });
    });

    it('404s an unknown slug', async () => {
        jest.spyOn(boards, 'resolveSlug').mockResolvedValue(null);
        await expect(controller.resolveBoard(tenant, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s an unknown task key', async () => {
        jest.spyOn(tasks, 'resolveTaskKey').mockResolvedValue(null);
        await expect(taskController.resolveTask(tenant, 'ERP-999')).rejects.toBeInstanceOf(NotFoundException);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/projects/url-resolve.controller`
Expected: FAIL

- [ ] **Step 3: Implement**

In `boards.controller.ts`, **above** `@Get(':id')`:

```ts
/**
 * Declared before `@Get(':id')`: Nest matches in declaration order, and an
 * `:id` route first would read `/resolve/erp71` as a board whose id is
 * "resolve".
 */
@Get('resolve/:slug')
@RequireStorePermission(StorePermission.VIEW_PROJECTS)
async resolveBoard(@Tenant() tenant: TenantContext, @Param('slug') slug: string) {
    const found = await this.boards.resolveSlug(tenant.tenantId, slug);
    if (!found) throw new NotFoundException('Board not found');
    return { id: found.boardId, currentKey: found.currentSlug, moved: found.moved };
}
```

The task controller gets the matching `@Get('resolve/:key')`, also declared before any `:id` route.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/projects/url-resolve.controller`
Expected: PASS

- [ ] **Step 5: Full backend check**

Run: `cd apps/backend && npx tsc --noEmit && npx jest src/projects`
Expected: typecheck at its pre-existing baseline (19 errors, all in unrelated spec files); project tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/projects/
git commit -m "feat(projects): endpoints that resolve a board slug and a task key

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Short routes

**Files:**
- Create: `apps/frontend/src/app/b/[slug]/page.tsx`
- Create: `apps/frontend/src/app/t/[key]/page.tsx`
- Modify: `apps/frontend/src/lib/routes.ts` (near `boardDetail` at :198)
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the two resolve endpoints
- Produces: `routes.b(slug)`, `routes.t(key)`, `routes.projects.boardWithTask(slug, taskKey)`; `api.resolveBoardSlug(slug)`, `api.resolveTaskKey(key)`

- [ ] **Step 1: Add the route helpers**

```ts
/** Short, shareable board URL: /b/erp71 */
b: (slug: string) => `/b/${slug}` as const,
/** Short, shareable task URL: /t/ERP-14 */
t: (key: string) => `/t/${key}` as const,
```

and beside `boardDetail`:

```ts
boardWithTask: (boardIdOrSlug: string, taskKey: string) =>
    `/projects/boards/${boardIdOrSlug}?task=${encodeURIComponent(taskKey)}` as const,
```

- [ ] **Step 2: Add the api calls**

```ts
resolveBoardSlug: (slug: string): Promise<{ id: string; currentKey: string; moved: boolean }> =>
    fetchWithAuth(`/projects/boards/resolve/${encodeURIComponent(slug)}`),
resolveTaskKey: (key: string): Promise<{ id: string; currentKey: string; moved: boolean }> =>
    fetchWithAuth(`/projects/tasks/resolve/${encodeURIComponent(key)}`),
```

- [ ] **Step 3: Write the short routes**

`app/b/[slug]/page.tsx` — a client component that resolves and replaces:

```tsx
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';

/**
 * `/b/<slug>` — the shareable board URL.
 *
 * Resolves to the board's id and replaces the history entry, so Back returns
 * to wherever the link was opened from rather than bouncing through here.
 */
export default function BoardShortLinkPage() {
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        api.resolveBoardSlug(slug)
            .then((found) => {
                if (!cancelled) router.replace(routes.projects.boardDetail(found.id));
            })
            .catch(() => {
                if (!cancelled) router.replace(routes.projects.boards);
            });
        return () => {
            cancelled = true;
        };
    }, [slug, router]);

    return null;
}
```

`app/t/[key]/page.tsx` is the same shape, resolving with `api.resolveTaskKey` and replacing with `routes.projects.taskDetail(found.id)`, falling back to `routes.projects.tasks`.

- [ ] **Step 4: Verify both routes build**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/b apps/frontend/src/app/t apps/frontend/src/lib/routes.ts apps/frontend/src/lib/api.ts
git commit -m "feat(frontend): /b/<slug> and /t/<key> short routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: A task open on a board has a URL

**Files:**
- Modify: `apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx`
- Test: `apps/frontend/src/app/(app)/projects/boards/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `routes.projects.boardWithTask`
- Produces: `?task=<id>` opens the panel; closing clears it

- [ ] **Step 1: Write the failing test**

```ts
describe('a task opened on the board has a URL', () => {
    it('opens the panel for a task named in ?task=', async () => {
        mockSearchParams.set('task', 'k1');
        render(<BoardPage />);
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('puts the task in the URL when a card is opened', async () => {
        render(<BoardPage />);
        fireEvent.click(await screen.findByText('Fix login'));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('task=k1')));
    });

    it('clears the param when the panel is closed, so Back leaves the board', async () => {
        mockSearchParams.set('task', 'k1');
        render(<BoardPage />);
        fireEvent.click(await screen.findByRole('button', { name: /close/i }));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.not.stringContaining('task=')));
    });

    it('ignores a ?task= naming a card that is not on this board', async () => {
        mockSearchParams.set('task', 'not-here');
        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest --testPathPatterns "boards"`
Expected: FAIL

- [ ] **Step 3: Implement**

Read `useSearchParams()` on mount and seed `openTaskId` from `?task=`, but only when a card with that id is on the board — a stale link must not open an empty panel. On open and on close, `router.replace` the URL with the param set or removed. `replace`, not `push`, so Back leaves the board rather than stepping through every card opened.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest --testPathPatterns "boards"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx" "apps/frontend/src/app/(app)/projects/boards/[id]/page.test.tsx"
git commit -m "feat(projects): a task opened on a board has its own URL

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Share button

**Files:**
- Modify: `apps/frontend/src/components/projects/TaskDetailPanel.tsx`
- Modify: `apps/frontend/src/lib/api.ts`
- Modify: all nine `apps/frontend/src/lib/localization/messages/<locale>/projects.ts`
- Test: `apps/frontend/src/components/projects/TaskDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `POST /short-links`
- Produces: a share button in the panel's title bar

> **The first implementation step is confirming how the frontend reads the
> `urlShortener` platform feature.** It is not in `packages/shared-types/index.ts`
> with the other feature keys — it is read server-side by
> `@RequiresFeature('urlShortener')`. Find how `platformFeatures` reaches a
> component (`layout.tsx` reads it; see `platformFeatures.support` at :659) and
> use the same source. A wrong guess degrades to copying the full URL, which is
> the fallback anyway.

- [ ] **Step 1: Write the failing test**

```ts
describe('sharing a task', () => {
    it('copies a short link when the workspace has the shortener', async () => {
        createShortLink.mockResolvedValue({ code: 'abc123' });
        panel({ platformFeatures: { urlShortener: true } });

        fireEvent.click(await screen.findByRole('button', { name: /share/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/s/abc123')));
    });

    it('copies the full URL when the workspace does not', async () => {
        panel({ platformFeatures: { urlShortener: false } });

        fireEvent.click(await screen.findByRole('button', { name: /share/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/t/')));
        expect(createShortLink).not.toHaveBeenCalled();
    });

    it('falls back to the full URL when shortening fails', async () => {
        // The person wanted a link, not a short link — a 403 from a missing
        // permission must not leave them with nothing.
        createShortLink.mockRejectedValue(new Error('forbidden'));
        panel({ platformFeatures: { urlShortener: true } });

        fireEvent.click(await screen.findByRole('button', { name: /share/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/t/')));
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest --testPathPatterns "TaskDetailPanel"`
Expected: FAIL — no share button

- [ ] **Step 3: Add the api call**

```ts
createShortLink: (targetUrl: string, label?: string): Promise<{ code: string }> =>
    fetchWithAuth('/short-links', {
        method: 'POST',
        body: JSON.stringify({ target_url: targetUrl, label }),
        headers: { 'Content-Type': 'application/json' },
    }),
```

- [ ] **Step 4: Add the four i18n keys to all nine locales**

`share`, `shareCopied`, `shareCopiedShort`, `shareFailed`. Match each file's
quote style — `en`, `bn` and `ms` use single quotes, the rest double.

- [ ] **Step 5: Implement the button**

A `Share2` icon button in the title bar. On click: build the canonical
`/t/<key>` URL from `window.location.origin`; if the workspace has
`urlShortener`, try `createShortLink` and copy `/s/<code>`; on any failure, or
without the feature, copy the full URL. Toast which one it was.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest --testPathPatterns "TaskDetailPanel"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/projects/TaskDetailPanel.tsx apps/frontend/src/components/projects/TaskDetailPanel.test.tsx apps/frontend/src/lib/api.ts apps/frontend/src/lib/localization/messages/
git commit -m "feat(projects): share a task as a link

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Show the key, and finish

**Files:**
- Modify: `apps/frontend/src/components/projects/TaskDetailPanel.tsx`
- Modify: `apps/frontend/src/app/(app)/projects/boards/[id]/page.tsx` (`TaskCard`)
- Modify: `TODO.md`

**Interfaces:**
- Consumes: `task.reference` and `task.project.code` from the API
- Produces: the key visible where a task is

- [ ] **Step 1: Show the key in the panel title bar**

`ERP-14` beside the title, in `text-xs text-gray-500 font-mono` — a key nobody
can see is a key nobody will quote.

- [ ] **Step 2: Show the key on the board card**

Same treatment in the card's meta row, gated on `show.badges` like its
neighbours.

- [ ] **Step 3: Verify the whole frontend**

Run:
```bash
cd apps/frontend && npx tsc --noEmit && npx jest --silent
```
Expected: 0 typecheck errors; all suites pass

- [ ] **Step 4: Verify the whole backend**

Run:
```bash
cd apps/backend && npx tsc --noEmit && npx jest src/ --silent && npm run build
```
Expected: typecheck at its 19-error baseline, tests pass, build exits 0

- [ ] **Step 5: Update `TODO.md`**

Per CLAUDE.md: move the completed work to `## COMPLETED` with today's date,
and add the follow-ups this work leaves open:
- no browser pass on either short route or the share button;
- the migrations have not run against production — the backfills are written
  and tested but unexecuted;
- project codes are editable through the API but no screen offers it;
- `/t/<key>` is case-sensitive on the code, so `erp-14` 404s where `ERP-14`
  works.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src TODO.md
git commit -m "feat(projects): show a task's key where the task is

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deployment note

Both migrations are additive and run automatically on deploy. They are safe to
ship before anything reads the new columns, so the schema can go out first if
the application changes need another pass.

**The backfills have not run against production.** 7 boards and 842 tasks is
small enough that they will complete in well under a second, but the numbering
they produce is what every future task key is built on — check the result
before anyone shares a link:

```sql
SELECT name, slug FROM boards ORDER BY tenant_id, name;
SELECT p.code, min(t.reference), max(t.reference), count(*)
FROM project_tasks t JOIN projects p ON p.id = t.project_id GROUP BY p.code;
```

Expect each project's references to run 1..n with no gaps.
