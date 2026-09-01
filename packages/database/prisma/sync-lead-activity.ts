/**
 * Backfills `Lead.last_activity_at` — when anyone last *worked* a lead, which
 * drives the CRM dashboard's 14-day neglected-leads tile and
 * `GET /crm/leads?staleDays=N`.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else. So migration `20260901140000_add_lead_last_activity_at`
 * — which adds the column and backfills it — only ever runs on a developer's
 * machine. Without this script the column lands in production as NULL on every
 * existing lead, the stale query falls back to `created_at` for all of them, and
 * the tile briefly counts the entire back catalogue as neglected.
 *
 * Where the value comes from
 * --------------------------
 * The same expression the migration uses, and for the same reason: each source
 * contributes a timestamp that means something. `CrmActivity.updated_at` is
 * trusted only on user-created rows, because sync-crm-activities backfilled the
 * R1 activity table without preserving its source rows' timestamps — every
 * backfilled activity carries the backfill run's clock, and trusting that would
 * stamp half the book as freshly worked.
 *
 * It runs on every container start, so it must be idempotent. It is: only leads
 * where `last_activity_at` is still NULL are considered, so a second run is a
 * no-op and a value the app has since written is never overwritten. Leads with
 * nothing to derive a timestamp from are skipped rather than re-written as NULL,
 * so a quiet run costs no writes at all.
 *
 * Usage:
 *   npx tsx prisma/sync-lead-activity.ts --dry-run
 *   npx tsx prisma/sync-lead-activity.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * "When was this lead last worked", per lead, from real event times.
 *
 * GREATEST ignores NULL arguments and yields NULL only when all of them are
 * NULL — so a lead nobody has ever worked comes back NULL and is left alone,
 * and the stale query falls back to its `created_at`.
 */
const DERIVED_TOUCHED_AT = `
    GREATEST(
        l2."last_contacted_at",
        (SELECT MAX(c."created_at") FROM "LeadConversation" c WHERE c."lead_id" = l2."id"),
        (
            SELECT MAX(GREATEST(
                a."completed_at",
                CASE WHEN a."legacy_source" IS NULL THEN a."updated_at" END
            ))
            FROM "CrmActivity" a WHERE a."lead_id" = l2."id"
        ),
        (
            SELECT MAX(GREATEST(f."created_at", f."completed_at"))
            FROM "CrmFollowUp" f WHERE f."lead_id" = l2."id"
        )
    )
`;

export interface SyncResult {
    /** Leads still missing the column. */
    scanned: number;
    /** Of those, the ones that had a real event to date them by. */
    filled: number;
    /** The rest: filed and never worked, left NULL for the created_at fallback. */
    untouched: number;
}

export async function syncLeadActivity(dryRun = false): Promise<SyncResult> {
    const [{ scanned, derivable }] = await prisma.$queryRawUnsafe<
        { scanned: bigint; derivable: bigint }[]
    >(`
        SELECT COUNT(*) AS scanned,
               COUNT(${DERIVED_TOUCHED_AT}) AS derivable
        FROM "Lead" l2
        WHERE l2."last_activity_at" IS NULL
    `);

    const result: SyncResult = {
        scanned: Number(scanned),
        filled: Number(derivable),
        untouched: Number(scanned) - Number(derivable),
    };

    if (!dryRun && result.filled > 0) {
        // One statement rather than a paged read/write loop: this is a pure
        // SQL-side derivation over indexed foreign keys, and a partial run is
        // safe anyway — the next boot picks up whatever is left.
        await prisma.$executeRawUnsafe(`
            UPDATE "Lead" l
            SET "last_activity_at" = src.touched_at
            FROM (
                SELECT l2."id" AS id, ${DERIVED_TOUCHED_AT} AS touched_at
                FROM "Lead" l2
                WHERE l2."last_activity_at" IS NULL
            ) src
            WHERE src.id = l."id" AND src.touched_at IS NOT NULL
        `);
    }

    return result;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result = await syncLeadActivity(dryRun);

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-lead-activity: scanned ${result.scanned} lead(s) with no last_activity_at, ` +
            `filled ${result.filled}, left ${result.untouched} never worked.`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-lead-activity failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
