/**
 * Fills `boards.slug` (and creates `board_slug_history`) so the unique index on
 * (tenant_id, slug) can be created and the column can be NOT NULL.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema — so migration `20260922120000_add_board_slug` never executes, and the
 * careful nullable → backfill → NOT NULL sequencing inside it never happens.
 *
 * What `db push` does instead is add `slug` as NOT NULL to a table that already
 * has rows, with no default. Postgres refuses, `db push` exits non-zero, and
 * because it sits at the head of the container's `&&` chain **the backend never
 * boots**. Same failure mode as `sync-user-mobile-unique.ts`, which is why this
 * runs ahead of `db push` rather than after it: by the time the column is made
 * NOT NULL and the index is built, every row already has a value.
 *
 * (Contrast `sync-lead-identity.ts`, which safely runs *after* `db push`: the
 * columns it fills are nullable, so nothing rejects them mid-flight.)
 *
 * How slugs are derived
 * ---------------------
 * Deliberately in TypeScript, reusing the same rules as `slugify` in
 * apps/backend/src/projects/url-keys/board-slug.ts, rather than the SQL in the
 * migration. The two are not equivalent: the migration's character class is
 * `[^a-z0-9ঀ-৿]` (ASCII plus the Bengali block), while the application uses
 * `\p{L}\p{N}\p{M}` — every script, plus the combining marks Bengali vowel signs
 * are built from. A board named in Arabic or Hindi backfills to a real slug here
 * and to the id fallback under the migration's SQL. Since the application is
 * what generates every slug from now on, its rules are the ones worth matching.
 *
 * Collisions are resolved oldest-first (`created_at`, then `id` to break ties
 * deterministically), so the longest-standing board keeps the bare slug and
 * later ones take `-2`, `-3`. A name that yields no slug at all — punctuation
 * only — falls back to `board-<first 8 of id>`, as `slugFallback` does.
 *
 * Already-set slugs are never rewritten: the script fills NULLs and leaves
 * everything else alone, so an owner's deliberate edit survives a redeploy.
 *
 * It runs on every container start, so it must be idempotent. It is: once every
 * board has a slug, the query returns nothing and the script is a no-op.
 *
 * Raw SQL rather than the typed client, deliberately — the script runs before
 * the schema has been synced, so the generated client may describe columns the
 * database does not have yet. It also tolerates the table or column being
 * absent, which is the fresh-database case: a first boot has nothing to backfill
 * and must not fail here.
 *
 * Usage:
 *   npx tsx prisma/sync-board-slug.ts --dry-run   # report only
 *   npx tsx prisma/sync-board-slug.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAX_LENGTH = 60;

interface Row {
    id: string;
    tenant_id: string;
    name: string;
}

/**
 * Lowercase, non-alphanumerics to hyphens, collapsed, trimmed, capped.
 *
 * Kept byte-for-byte in step with `slugify` in
 * apps/backend/src/projects/url-keys/board-slug.ts. Duplicated rather than
 * imported because this package must not depend on the backend workspace, and
 * the script runs from a container where only packages/database is installed.
 */
function slugify(name: string): string {
    return (name ?? '')
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, MAX_LENGTH)
        .replace(/-$/, '');
}

/** For a name that yields no slug at all — punctuation only, say. */
function slugFallback(id: string): string {
    return `board-${id.slice(0, 8)}`;
}

/** `otb`, then `otb-2`, `otb-3`, … against the slugs already taken. */
function uniqueSlug(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

/**
 * Is there a `boards` table to work on? A database that has never had `db push`
 * run against it has no such table, and this script sits ahead of the step that
 * would create it.
 */
async function boardsTableExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
        WHERE table_name = 'boards'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

/**
 * Add `slug` if it is missing, so a database mid-upgrade gets the column before
 * anything tries to write it. Nullable here on purpose — `db push` is what makes
 * it NOT NULL, after this script has filled it.
 */
async function ensureSlugColumn(): Promise<void> {
    await prisma.$executeRawUnsafe(
        'ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "slug" TEXT',
    );
}

/**
 * `board_slug_history` starts empty and fills as boards are renamed. Created
 * here because `db push` will create it too, but the application may read it
 * during the window before that runs.
 */
async function ensureHistoryTable(): Promise<void> {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "board_slug_history" (
            "id" TEXT NOT NULL,
            "tenant_id" TEXT NOT NULL,
            "board_id" TEXT NOT NULL,
            "slug" TEXT NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "board_slug_history_pkey" PRIMARY KEY ("id")
        )
    `);
}

/** Slugs already spoken for in each tenant, so a backfill cannot collide. */
async function loadTakenByTenant(): Promise<Map<string, Set<string>>> {
    const rows = await prisma.$queryRaw<Array<{ tenant_id: string; slug: string }>>`
        SELECT tenant_id, slug FROM "boards" WHERE slug IS NOT NULL
    `;

    const taken = new Map<string, Set<string>>();
    for (const row of rows) {
        const set = taken.get(row.tenant_id) ?? new Set<string>();
        set.add(row.slug);
        taken.set(row.tenant_id, set);
    }
    return taken;
}

/** Boards still missing a slug, oldest first so they keep the bare form. */
async function loadUnslugged(): Promise<Row[]> {
    return prisma.$queryRaw<Row[]>`
        SELECT id, tenant_id, name
        FROM "boards"
        WHERE slug IS NULL
        ORDER BY created_at, id
    `;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await boardsTableExists())) {
        console.log('[sync-board-slug] No boards table yet — fresh database, nothing to do.');
        return;
    }

    if (!dryRun) {
        await ensureSlugColumn();
        await ensureHistoryTable();
    } else if (!(await slugColumnExists())) {
        console.log('[sync-board-slug] --dry-run: boards.slug does not exist yet; nothing to report.');
        return;
    }

    const rows = await loadUnslugged();
    if (rows.length === 0) {
        console.log('[sync-board-slug] Every board already has a slug. Nothing to do.');
        return;
    }

    const taken = await loadTakenByTenant();
    const planned: Array<{ id: string; name: string; slug: string }> = [];

    for (const row of rows) {
        const set = taken.get(row.tenant_id) ?? new Set<string>();
        const base = slugify(row.name) || slugFallback(row.id);
        const slug = uniqueSlug(base, set);
        set.add(slug);
        taken.set(row.tenant_id, set);
        planned.push({ id: row.id, name: row.name, slug });
    }

    console.log(`[sync-board-slug] ${planned.length} board(s) need a slug:`);
    for (const item of planned) {
        console.log(`    ${item.slug}   (from "${item.name}")`);
    }

    if (dryRun) {
        console.log(`[sync-board-slug] --dry-run: would set ${planned.length} slug(s). No changes made.`);
        return;
    }

    for (const item of planned) {
        await prisma.$executeRaw`
            UPDATE "boards" SET slug = ${item.slug} WHERE id = ${item.id} AND slug IS NULL
        `;
    }

    console.log(`[sync-board-slug] Set ${planned.length} slug(s).`);
}

/** Only needed on the --dry-run path, where the column is not created first. */
async function slugColumnExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'slug'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

main()
    .catch((error) => {
        console.error('[sync-board-slug] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
