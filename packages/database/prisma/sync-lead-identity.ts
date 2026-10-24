/**
 * Backfills `Lead.mobile_norm` / `email_norm` / `linkedin_norm` from the raw
 * `mobile`, `email`, and `linkedin_url` columns.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile and
 * apps/backend/scripts/db-prepare.sh), which syncs the *shape* of the schema
 * and nothing else. The migration that first added these columns only ever runs
 * on a developer's machine. Without this script a production deploy would leave
 * every existing lead's norms NULL.
 *
 * It runs on every container start, so it must be idempotent. It is: a lead
 * whose normalized column is already set is never touched, so a second run is a
 * no-op, and a lead whose norms are already set is absent from the updates.
 *
 * Shared values
 * -------------
 * The per-tenant unique indexes on these columns are gone. Several leads may
 * share one mobile, one email, or one LinkedIn profile. Leaving a shared norm
 * null would hide an email the user can already see on the raw column — and the
 * same for a mobile or a LinkedIn URL. The sync writes that normalized value
 * onto every lead whose norm is still null.
 *
 * It does not write `email`, `mobile`, or `linkedin_url`. Nothing a user can
 * see changes, and nothing is deleted.
 *
 * The normalization is imported from @erp71/shared-types rather than reimplemented
 * in SQL, so this and the application can never disagree about what counts as the
 * same phone number.
 *
 * Usage:
 *   npx tsx prisma/sync-lead-identity.ts --dry-run
 *   npx tsx prisma/sync-lead-identity.ts --tenant=<uuid>
 *   npx tsx prisma/sync-lead-identity.ts
 */

import { PrismaClient } from '@prisma/client';
import { leadIdentityOf, LEAD_IDENTITY_FIELDS, type LeadIdentity } from '@erp71/shared-types';

const prisma = new PrismaClient();

/** Leads are read in pages so a large tenant does not land in memory at once. */
const PAGE_SIZE = 2000;

interface Row {
    id: string;
    tenant_id: string;
    mobile: string | null;
    email: string | null;
    linkedin_url: string | null;
    mobile_norm: string | null;
    email_norm: string | null;
    linkedin_norm: string | null;
}

export interface SyncResult {
    scanned: number;
    filled: number;
}

/**
 * Decides what to write. Pure, so the rule is testable without a database.
 *
 * Every still-null `mobile_norm`, `email_norm`, and `linkedin_norm` is filled
 * from the raw column, including when another lead already holds that value.
 * A column that is already set is left alone, and a lead whose norms are
 * already set is absent from `updates`.
 *
 * `claimed` stays so existing callers compile. It no longer causes a shared
 * lead norm to be skipped: the unique indexes that made a second write throw
 * are gone.
 *
 * `data` holds only norm keys. `email`, `mobile`, and `linkedin_url` are never
 * written.
 */
export function planBackfill(rows: Row[], claimed: Set<string>) {
    void claimed;
    const updates: { id: string; data: Partial<LeadIdentity> }[] = [];

    for (const row of rows) {
        const identity = leadIdentityOf(row);
        const data: Partial<LeadIdentity> = {};

        for (const field of LEAD_IDENTITY_FIELDS) {
            // Already set — either by the application on write, or by an earlier
            // run of this script. Never re-derived, so a value a human corrected
            // is not quietly overwritten.
            if (row[field] != null) continue;

            const value = identity[field];
            if (value == null) continue;

            data[field] = value;
        }

        if (Object.keys(data).length) updates.push({ id: row.id, data });
    }

    return { updates, collisions: 0 };
}

async function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const tenantArg = argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
    const where = tenantArg ? { tenant_id: tenantArg } : {};

    // `claimed` no longer withholds a shared norm. An empty set keeps the
    // planner signature the callers already compile against.
    const claimed = new Set<string>();

    const result: SyncResult = { scanned: 0, filled: 0 };
    let cursor: string | undefined;

    for (;;) {
        // `id` breaks ties so paging is stable. Oldest-first no longer decides
        // who keeps a shared value: every still-null norm is filled.
        const page: Row[] = await prisma.lead.findMany({
            where,
            select: {
                id: true,
                tenant_id: true,
                mobile: true,
                email: true,
                linkedin_url: true,
                mobile_norm: true,
                email_norm: true,
                linkedin_norm: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;

        result.scanned += page.length;
        const { updates } = planBackfill(page, claimed);

        if (!dryRun) {
            // Sequential, not a transaction: a partial backfill is safe (the rest
            // is picked up on the next boot) whereas one long transaction over
            // every lead in the system is not.
            for (const update of updates) {
                await prisma.lead.update({ where: { id: update.id }, data: update.data });
            }
        }
        result.filled += updates.length;

        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-lead-identity: scanned ${result.scanned} lead(s), ` +
            `filled ${result.filled} identity key set(s).`,
    );
}

// Only run the driver when invoked as a script, so `planBackfill` can be
// imported by tests without opening a database connection.
if (require.main === module) {
    main()
        .catch((error) => {
            // Non-zero on purpose. `db-prepare.sh` treats a failed step as
            // fatal and does not boot the new process; the old one keeps
            // serving. A thrown error must not look like a finished backfill.
            console.error('sync-lead-identity failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
