/**
 * Clears duplicate `User.mobile` values so the unique index on that column can
 * be created.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema — including creating the unique index that migration
 * `20260907120000_user_mobile_unique` adds.
 *
 * That index is created on a column which is **already populated**, and mobile
 * numbers were explicitly allowed to repeat between 2026-07-10 and now (see
 * `20260710120000_drop_user_mobile_unique`). If two accounts still share a
 * number, Postgres refuses to build the index, `db push` exits non-zero, and
 * because it sits at the head of the container's `&&` chain **the backend never
 * boots** — a duplicate row in the data becomes a total outage.
 *
 * So unlike every other `sync:*` script, this one runs *ahead* of `db push`
 * rather than after it. By the time the index is built there is nothing left for
 * it to trip over. (`sync-lead-identity.ts` has the mirror-image problem and can
 * safely run after `db push`, because the columns it fills are brand new and
 * therefore all NULL when its indexes are created.)
 *
 * What it does to a collision
 * ---------------------------
 * Nothing is ever deleted, and no account loses access — `mobile` is a contact
 * and lookup field, never the credential. For each repeated number exactly one
 * account keeps it and the rest have `mobile` set to NULL:
 *
 *   1. An account that **proved** the number by SMS (`mobile_verified_at`) wins
 *      over one that merely typed it into a form. Handing a verified number to
 *      the account that never confirmed it would be the wrong way round.
 *   2. Failing that, the **oldest** account keeps it, matching how
 *      `mobileSignIn` already ordered candidates and how `sync-lead-identity`
 *      resolves its own collisions.
 *
 * A loser's `mobile_verified_at` is cleared alongside the number: a verification
 * timestamp with no number attached would claim the account had proved something
 * it no longer holds. Those users sign in with their email address and can set a
 * different number later.
 *
 * It runs on every container start, so it must be idempotent. It is: once no
 * number repeats, the query returns nothing and the script is a no-op.
 *
 * Everything here is raw SQL rather than the typed client, deliberately. The
 * script runs before the schema has been synced, so the generated client may
 * describe columns the database does not have yet; naming the five columns it
 * actually needs keeps it working across that gap. It also tolerates the table
 * or column being absent altogether, which is the fresh-database case — a first
 * boot has nothing to dedupe and must not fail here.
 *
 * Usage:
 *   npx tsx prisma/sync-user-mobile-unique.ts --dry-run   # report only
 *   npx tsx prisma/sync-user-mobile-unique.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Row {
    id: string;
    email: string;
    mobile: string;
    mobile_verified_at: Date | null;
    created_at: Date;
}

/**
 * Is there a `User.mobile` column to work on? A database that has never had
 * `db push` run against it has no `User` table at all, and this script sits
 * ahead of the step that would create it.
 */
async function mobileColumnExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'mobile'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

/**
 * Every row whose number is shared with at least one other account, ordered so
 * the keeper for each number comes first: verified ahead of unverified
 * (`mobile_verified_at IS NULL` sorts false before true), then oldest first.
 */
async function loadCollisions(): Promise<Row[]> {
    return prisma.$queryRaw<Row[]>`
        SELECT id, email, mobile, mobile_verified_at, created_at
        FROM "User"
        WHERE mobile IS NOT NULL
          AND mobile IN (
              SELECT mobile FROM "User" WHERE mobile IS NOT NULL
              GROUP BY mobile HAVING COUNT(*) > 1
          )
        ORDER BY mobile, (mobile_verified_at IS NULL), created_at
    `;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await mobileColumnExists())) {
        console.log('[sync-user-mobile-unique] No User.mobile column yet — fresh database, nothing to do.');
        return;
    }

    const rows = await loadCollisions();
    if (rows.length === 0) {
        console.log('[sync-user-mobile-unique] No duplicate mobile numbers. Nothing to do.');
        return;
    }

    const byNumber = new Map<string, Row[]>();
    for (const row of rows) {
        const group = byNumber.get(row.mobile);
        if (group) group.push(row);
        else byNumber.set(row.mobile, [row]);
    }

    console.log(
        `[sync-user-mobile-unique] ${byNumber.size} mobile number(s) shared by ${rows.length} accounts:`,
    );

    const losers: Row[] = [];
    for (const [mobile, group] of Array.from(byNumber.entries())) {
        const [keeper, ...rest] = group;
        losers.push(...rest);
        const why = keeper.mobile_verified_at ? 'verified' : 'oldest';
        console.log(`  ${mobile}`);
        console.log(`    keep   ${keeper.email} (${why}, created ${keeper.created_at.toISOString()})`);
        for (const row of rest) {
            console.log(`    clear  ${row.email} (created ${row.created_at.toISOString()})`);
        }
    }

    if (dryRun) {
        console.log(`[sync-user-mobile-unique] --dry-run: would clear ${losers.length} number(s). No changes made.`);
        return;
    }

    for (const row of losers) {
        await prisma.$executeRaw`
            UPDATE "User" SET mobile = NULL, mobile_verified_at = NULL WHERE id = ${row.id}
        `;
    }

    console.log(`[sync-user-mobile-unique] Cleared ${losers.length} duplicate number(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-user-mobile-unique] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
