/**
 * Fills null `CrmContact.mobile_norm` / `email_norm` / `linkedin_norm`.
 *
 * Why this exists
 * ---------------
 * Production applies schema with `prisma db push`, which adds the columns and
 * their unique indexes but never fills them. `mobile_norm` and `linkedin_norm`
 * are unique per tenant. The oldest contact keeps a contested value; a later
 * contact that normalizes to the same value keeps a null norm and keeps its
 * raw mobile or URL. `email_norm` is not unique and is filled on every contact
 * that has an email. This is not `planBackfill`: a shared lead norm is written,
 * a shared contact mobile or LinkedIn is not.
 *
 * It runs on every prepare, so it must be idempotent. A column that is already
 * set is left alone. The update payload is only the norm keys the planner
 * returned — never name, mobile, email, company, or notes.
 *
 * Rows are read oldest-`created_at`-then-`id`, in pages, then planned as one
 * set. `planContactNorms` claims every stored mobile and LinkedIn before it
 * fills, so a value already stored on a later row is not taken by an older null.
 *
 * Usage:
 *   npx tsx prisma/sync-contact-identity.ts --dry-run
 *   npx tsx prisma/sync-contact-identity.ts --tenant=<uuid>
 *   npx tsx prisma/sync-contact-identity.ts
 */

import { PrismaClient } from '@prisma/client';
import { planContactNorms, type ContactNormRow } from './crm-identity-plan';

const prisma = new PrismaClient();

/** Contacts are read in pages so one findMany does not hold a long cursor. */
const PAGE_SIZE = 2000;

interface SyncResult {
    scanned: number;
    planned: number;
    /** Contested mobile or LinkedIn norms the planner refused to write. */
    contested: number;
}

function scriptOptions(argv: string[]) {
    const dryRun = argv.includes('--dry-run');
    const tenantId = argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
    const where = tenantId ? { tenant_id: tenantId } : {};
    return { dryRun, where };
}

async function loadContacts(where: { tenant_id?: string }): Promise<ContactNormRow[]> {
    const rows: ContactNormRow[] = [];
    let cursor: string | undefined;

    for (;;) {
        const page: ContactNormRow[] = await prisma.crmContact.findMany({
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
                created_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;
        rows.push(...page);
        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

/** Only the norm keys `planContactNorms` returned. A null norm is not written. */
function normUpdate(data: { mobile_norm?: string; email_norm?: string; linkedin_norm?: string }) {
    const update: { mobile_norm?: string; email_norm?: string; linkedin_norm?: string } = {};
    if (data.mobile_norm != null) update.mobile_norm = data.mobile_norm;
    if (data.email_norm != null) update.email_norm = data.email_norm;
    if (data.linkedin_norm != null) update.linkedin_norm = data.linkedin_norm;
    return update;
}

async function main() {
    const { dryRun, where } = scriptOptions(process.argv.slice(2));
    const rows = await loadContacts(where);
    // Empty: the planner claims norms stored on these rows itself. Do not copy
    // `planBackfill`, which now fills a shared lead norm.
    const { updates, collisions } = planContactNorms(rows, new Set<string>());
    const result: SyncResult = { scanned: rows.length, planned: 0, contested: collisions };

    for (const update of updates) {
        const data = normUpdate(update.data);
        if (Object.keys(data).length === 0) continue;
        result.planned += 1;
        if (!dryRun) {
            // Sequential, not one transaction over every contact: a partial fill
            // is safe (the next prepare picks up the rest) and a long lock is not.
            await prisma.crmContact.update({ where: { id: update.id }, data });
        }
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-contact-identity: scanned ${result.scanned} contact(s), ` +
            `planned ${result.planned} norm update(s), ` +
            `left ${result.contested} contested mobile or LinkedIn norm(s) unset.`,
    );
}

// Only run the driver when invoked as a script. Importing it must not connect.
if (require.main === module) {
    main()
        .catch((error) => {
            // Non-zero on purpose. `db-prepare.sh` treats this step as fatal.
            // A thrown error must not look like a finished backfill.
            console.error('sync-contact-identity failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
