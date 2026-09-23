/**
 * Fills `project_user_stories.code` so the column can be NOT NULL and the
 * unique index on (project_id, code) can be built.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Same reason as `sync-task-reference.ts`: production boots with `prisma db
 * push`, not `prisma migrate deploy`, so migration
 * `20260923120000_add_story_code` never runs. `db push` would add `code` as NOT
 * NULL to a table that already has rows, Postgres would refuse, and the backend
 * would never boot. This fills the column first.
 *
 * How codes are assigned
 * ----------------------
 * `<project.code>-<reference>` — the story keeps the number it already had, now
 * under its project's code instead of `US-`. Existing codes are never rewritten.
 *
 * Idempotent: once every story has a code the UPDATE touches nothing. Raw SQL,
 * because the generated client may describe a column the database does not
 * have yet; tolerates the table being absent (fresh database).
 *
 * Usage:
 *   npx tsx prisma/sync-story-code.ts --dry-run   # report only
 *   npx tsx prisma/sync-story-code.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function columnCount(table: string, column?: string): Promise<number> {
    const rows = column
        ? await prisma.$queryRaw<Array<{ count: bigint }>>`
              SELECT COUNT(*)::bigint AS count FROM information_schema.columns
              WHERE table_name = ${table} AND column_name = ${column}
          `
        : await prisma.$queryRaw<Array<{ count: bigint }>>`
              SELECT COUNT(*)::bigint AS count FROM information_schema.tables
              WHERE table_name = ${table}
          `;
    return Number(rows[0]?.count ?? 0);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if ((await columnCount('project_user_stories')) === 0) {
        console.log('[sync-story-code] No project_user_stories table yet — fresh database, nothing to do.');
        return;
    }

    if (!dryRun) {
        // Nullable here on purpose — `db push` makes it NOT NULL once it is filled.
        await prisma.$executeRawUnsafe(
            'ALTER TABLE "project_user_stories" ADD COLUMN IF NOT EXISTS "code" TEXT',
        );
    } else if ((await columnCount('project_user_stories', 'code')) === 0) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count FROM "project_user_stories"
        `;
        console.log(
            `[sync-story-code] --dry-run: code column missing; would fill ${Number(rows[0]?.count ?? 0)} story(ies).`,
        );
        return;
    }

    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "project_user_stories" WHERE code IS NULL
    `;
    const count = Number(pending[0]?.count ?? 0);
    if (count === 0) {
        console.log('[sync-story-code] Every story already has a code. Nothing to do.');
        return;
    }

    if (dryRun) {
        console.log(`[sync-story-code] --dry-run: would fill ${count} story code(s). No changes made.`);
        return;
    }

    const updated = await prisma.$executeRaw`
        UPDATE "project_user_stories" s
        SET code = p.code || '-' || s.reference
        FROM "projects" p
        WHERE s.project_id = p.id AND s.code IS NULL
    `;
    console.log(`[sync-story-code] Filled ${updated} story code(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-story-code] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
