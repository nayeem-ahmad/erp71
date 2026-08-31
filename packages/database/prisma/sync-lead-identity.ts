/**
 * Backfills `Lead.mobile_norm` / `email_norm` / `linkedin_norm` — the normalized
 * identity columns that carry the per-tenant unique indexes stopping duplicate
 * leads.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else. So migration `20260831120000_lead_identity_dedupe_keys`
 * — which adds these columns, backfills them and resolves the collisions already
 * in the data — only ever runs on a developer's machine.
 *
 * Without this script, a production deploy would add the three columns as all
 * NULL, create the three unique indexes (which succeeds precisely *because* the
 * columns are empty), and drop the old raw-string `@@unique([tenant_id, mobile])`.
 * Every existing lead would end up with no identity keys at all: duplicate
 * detection would match only leads created after the deploy, and the raw-mobile
 * protection that was there before would be gone. Silently — new leads would
 * look fine.
 *
 * It runs on every container start, so it must be idempotent. It is: a lead
 * whose normalized column is already set is never touched, so a second run is a
 * no-op.
 *
 * Collisions
 * ----------
 * The data already holds duplicates — that is the whole reason for the indexes.
 * A blind backfill would throw on the first collision, and this sits inside the
 * `&&` chain ahead of `node main.js` in the container CMD, where that means the
 * backend never boots. So for each identity value, only the OLDEST lead claiming
 * it is filled in; the later ones keep a NULL normalized column, exactly as the
 * migration leaves them. Nothing is deleted and nothing a user can see changes —
 * those leads simply hold no index entry until someone merges them.
 * `scripts/lead-duplicates.ts` (or `scripts/sql/lead-duplicates.sql`) reports
 * and clears them.
 *
 * A consequence worth knowing: if the keeper is later deleted, the next boot
 * promotes the next-oldest duplicate into the index. That is the behaviour we
 * want — the value stays protected by whichever lead still holds it.
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
    /** Leads left unindexed because an older lead already holds the value. */
    collisions: number;
}

/**
 * Decides what to write, given the leads in `created_at` order and the values
 * already claimed. Pure, so the rule is testable without a database.
 *
 * `claimed` is seeded with the values already present in the columns and is
 * mutated as the pass proceeds, which is what makes the oldest lead win: a value
 * is claimed once, by the first lead to reach it.
 */
export function planBackfill(rows: Row[], claimed: Set<string>) {
    const updates: { id: string; data: Partial<LeadIdentity> }[] = [];
    let collisions = 0;

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

            const key = `${row.tenant_id} ${field} ${value}`;
            if (claimed.has(key)) {
                collisions++;
                continue;
            }
            claimed.add(key);
            data[field] = value;
        }

        if (Object.keys(data).length) updates.push({ id: row.id, data });
    }

    return { updates, collisions };
}

async function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const tenantArg = argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
    const where = tenantArg ? { tenant_id: tenantArg } : {};

    // Values already in the columns, so a re-run cannot hand a value to a second
    // lead. Loaded up front rather than queried per row: one pass over the
    // indexed columns beats one round trip per lead.
    const claimed = new Set<string>();
    const existing = await prisma.lead.findMany({
        where: {
            ...where,
            OR: LEAD_IDENTITY_FIELDS.map((field) => ({ [field]: { not: null } })),
        },
        select: { tenant_id: true, mobile_norm: true, email_norm: true, linkedin_norm: true },
    });
    for (const row of existing) {
        for (const field of LEAD_IDENTITY_FIELDS) {
            const value = row[field];
            if (value != null) claimed.add(`${row.tenant_id} ${field} ${value}`);
        }
    }

    const result: SyncResult = { scanned: 0, filled: 0, collisions: 0 };
    let cursor: string | undefined;

    for (;;) {
        // Ordered oldest first, because the oldest lead is the one that keeps a
        // contested value. `id` breaks ties so paging is stable.
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
        const { updates, collisions } = planBackfill(page, claimed);
        result.collisions += collisions;

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
            `filled ${result.filled} identity key set(s), ` +
            `left ${result.collisions} duplicate key(s) unindexed.`,
    );
    if (result.collisions > 0) {
        console.log(
            '  Those leads are duplicates of an older lead and hold no index entry. ' +
                'Run scripts/lead-duplicates.ts to review or clear them.',
        );
    }
}

// Only run the driver when invoked as a script, so `planBackfill` can be
// imported by tests without opening a database connection.
if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-lead-identity failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
