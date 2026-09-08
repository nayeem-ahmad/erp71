/**
 * Marks every non-PLANNED `CrmActivity` as approved.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else — so migration `20260908120000_add_crm_activity_approval`,
 * which adds `is_approved` **and** backfills it, only ever runs on a developer's
 * machine. In production `db push` adds the column at its default of `false` and
 * stops there. Same trap that caught `sync-lead-identity` and `sync-lead-activity`.
 *
 * Why that matters
 * ----------------
 * `is_approved = false` means "a reviewer has not signed this off yet", and the
 * Activities page has an "Awaiting approval" filter that reads exactly that. Left
 * alone, every conversation the tenant has ever logged — years of DONE rows —
 * lands in that filter on the day this deploys, and the reviewer's queue opens
 * showing the entire history of the business instead of the handful of plans that
 * actually need reading.
 *
 * What it does and does not touch
 * -------------------------------
 * DONE rows record a call that already happened; CANCELLED rows record one that
 * never will. Neither is a question a reviewer can still answer, so both are
 * stamped approved.
 *
 * PLANNED rows are deliberately left alone. That open backlog is the review queue
 * the feature exists to create — approving it wholesale on the first deploy would
 * sign off, unread, exactly the work a reviewer was supposed to read.
 *
 * `approved_by` is never written. Nobody actually approved these rows, and naming
 * a reviewer who did not look is worse than naming none — an audit reading
 * `approved_by` would find a person to hold responsible for a decision no person
 * made.
 *
 * Idempotent: only rows that are still false are touched, so a second run is a
 * no-op and a reviewer's later decision is never overwritten.
 *
 * Usage:
 *   npx tsx prisma/sync-crm-activity-approval.ts --dry-run
 *   npx tsx prisma/sync-crm-activity-approval.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SyncResult {
    /** Non-PLANNED rows still sitting at the column default. */
    scanned: number;
    stamped: number;
    /** PLANNED rows left unapproved on purpose — the reviewer's queue. */
    awaitingReview: number;
}

export async function syncCrmActivityApproval(
    client: PrismaClient,
    dryRun = false,
): Promise<SyncResult> {
    const settled = { is_approved: false, status: { not: 'PLANNED' } } as const;

    const scanned = await client.crmActivity.count({ where: settled });
    const awaitingReview = await client.crmActivity.count({
        where: { is_approved: false, status: 'PLANNED' },
    });

    const result: SyncResult = { scanned, stamped: 0, awaitingReview };
    if (scanned === 0 || dryRun) return result;

    // One statement, not a per-row loop: a long-lived tenant can carry hundreds
    // of thousands of logged conversations, and this sits in the container start
    // chain ahead of the app booting.
    const { count } = await client.crmActivity.updateMany({
        where: settled,
        data: { is_approved: true },
    });
    result.stamped = count;
    return result;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result = await syncCrmActivityApproval(prisma, dryRun);
    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-crm-activity-approval: scanned ${result.scanned} settled activity(ies) with no approval flag, ` +
            `stamped ${result.stamped}. ${result.awaitingReview} planned activity(ies) left awaiting a reviewer.`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-crm-activity-approval failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
