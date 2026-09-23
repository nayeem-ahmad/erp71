/**
 * Fills `project_tasks.reference` (and creates `project_code_history`) so the
 * unique index on (project_id, reference) can be created and the column can be
 * NOT NULL.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema — so migration `20260922130000_add_task_reference` never executes, and
 * the nullable → backfill → NOT NULL sequencing inside it never happens.
 *
 * What `db push` does instead is add `reference` as NOT NULL to a table that
 * already has rows, with no default. Postgres refuses, `db push` exits non-zero,
 * and because it sits at the head of the container's `&&` chain **the backend
 * never boots**. Hence this runs ahead of `db push`, like
 * `sync-user-mobile-unique.ts`: by the time the column is made NOT NULL and the
 * index is built, every row already has a value.
 *
 * How references are assigned
 * ---------------------------
 * 1-based within a project, in `created_at` order so the oldest task is 1 —
 * the numbering somebody reading the project would expect. Ties on `created_at`
 * (a bulk import writes many rows in the same millisecond) break on `id`, so
 * the result is deterministic rather than whatever order the planner produced.
 *
 * Numbering continues from the highest reference a project already has, so a
 * partially-backfilled project — the script interrupted midway, or new tasks
 * created between boots — carries on rather than restarting at 1 and colliding.
 * Existing references are never rewritten.
 *
 * Soft-deleted tasks are numbered too. They still occupy a row under the unique
 * index, and skipping them would leave gaps that later undeletes could not fill.
 *
 * It runs on every container start, so it must be idempotent. It is: once every
 * task has a reference, the query returns nothing and the script is a no-op.
 *
 * Raw SQL rather than the typed client, deliberately — the script runs before
 * the schema has been synced, so the generated client may describe columns the
 * database does not have yet. It also tolerates the table or column being
 * absent, which is the fresh-database case.
 *
 * Usage:
 *   npx tsx prisma/sync-task-reference.ts --dry-run   # report only
 *   npx tsx prisma/sync-task-reference.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Row {
    id: string;
    project_id: string;
}

/**
 * Is there a `project_tasks` table to work on? A database that has never had
 * `db push` run against it has no such table, and this script sits ahead of the
 * step that would create it.
 */
async function tasksTableExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
        WHERE table_name = 'project_tasks'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

async function referenceColumnExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.columns
        WHERE table_name = 'project_tasks' AND column_name = 'reference'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

/**
 * Add `reference` if it is missing. Nullable here on purpose — `db push` is what
 * makes it NOT NULL, after this script has filled it.
 */
async function ensureReferenceColumn(): Promise<void> {
    await prisma.$executeRawUnsafe(
        'ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "reference" INTEGER',
    );
}

/**
 * `project_code_history` starts empty and fills as project codes are edited. A
 * task key is composed from its project's code, so without this, changing
 * PRJ-0002 to ERP would invalidate every PRJ-0002-14 ever pasted anywhere.
 */
async function ensureHistoryTable(): Promise<void> {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "project_code_history" (
            "id" TEXT NOT NULL,
            "tenant_id" TEXT NOT NULL,
            "project_id" TEXT NOT NULL,
            "code" TEXT NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "project_code_history_pkey" PRIMARY KEY ("id")
        )
    `);
}

/** Highest reference already assigned per project, so numbering continues. */
async function loadHighWaterMarks(): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<Array<{ project_id: string; max: number | null }>>`
        SELECT project_id, MAX(reference) AS max
        FROM "project_tasks"
        WHERE reference IS NOT NULL
        GROUP BY project_id
    `;

    const marks = new Map<string, number>();
    for (const row of rows) {
        marks.set(row.project_id, Number(row.max ?? 0));
    }
    return marks;
}

/** Tasks still missing a reference, oldest first within each project. */
async function loadUnnumbered(): Promise<Row[]> {
    return prisma.$queryRaw<Row[]>`
        SELECT id, project_id
        FROM "project_tasks"
        WHERE reference IS NULL
        ORDER BY project_id, created_at, id
    `;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await tasksTableExists())) {
        console.log('[sync-task-reference] No project_tasks table yet — fresh database, nothing to do.');
        return;
    }

    if (!dryRun) {
        await ensureReferenceColumn();
        await ensureHistoryTable();
    } else if (!(await referenceColumnExists())) {
        console.log('[sync-task-reference] --dry-run: project_tasks.reference does not exist yet; nothing to report.');
        return;
    }

    const rows = await loadUnnumbered();
    if (rows.length === 0) {
        console.log('[sync-task-reference] Every task already has a reference. Nothing to do.');
        return;
    }

    const marks = await loadHighWaterMarks();
    const planned: Array<{ id: string; project_id: string; reference: number }> = [];

    for (const row of rows) {
        const next = (marks.get(row.project_id) ?? 0) + 1;
        marks.set(row.project_id, next);
        planned.push({ id: row.id, project_id: row.project_id, reference: next });
    }

    const projectCount = new Set(planned.map((p) => p.project_id)).size;
    console.log(
        `[sync-task-reference] ${planned.length} task(s) across ${projectCount} project(s) need a reference.`,
    );

    if (dryRun) {
        console.log(`[sync-task-reference] --dry-run: would number ${planned.length} task(s). No changes made.`);
        return;
    }

    for (const item of planned) {
        await prisma.$executeRaw`
            UPDATE "project_tasks"
            SET reference = ${item.reference}
            WHERE id = ${item.id} AND reference IS NULL
        `;
    }

    console.log(`[sync-task-reference] Numbered ${planned.length} task(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-task-reference] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
