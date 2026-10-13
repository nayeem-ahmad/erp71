/**
 * Posts the customer and supplier opening dues that external-sync imported
 * before it posted them to the books.
 *
 * Why this exists
 * ---------------
 * `applyOpeningBalance` wrote each imported opening as a ledger row and moved
 * the party's `due_balance`, but posted no voucher. The customer and supplier
 * ledgers are read from the GL, so for every imported party with an opening
 * due, the ledger's closing balance came out short of the previous due the
 * sale screen shows, by exactly that opening. The importer now posts the
 * opening (Dr Accounts Receivable / Cr Opening Balance Equity, or Dr Opening
 * Balance Equity / Cr Purchase Payable); this gives the openings already
 * imported the same voucher.
 *
 * Safe by construction:
 *   - Each voucher is keyed on its opening's ledger row, so a re-run skips
 *     what an earlier one posted.
 *   - An opening dated into a LOCKED fiscal period is reported, never
 *     force-posted. Unlock the period and re-run to include it.
 *   - --dry-run posts each one inside a transaction and rolls it back, so the
 *     preview hits the same locked periods and missing accounts a live run
 *     would, and writes nothing.
 *
 * Needs the Opening Balance Equity account, which `sync:accounting` adds on
 * every container start. This CHANGES THE BOOKS of every tenant that imported
 * openings: receivables, payables and equity at the import's start date.
 * Review the dry run before running live.
 *
 * Usage (in production, through the compiled script — see TODO.md on why the
 * backend's tsx scripts do not run in the image):
 *   node apps/backend/dist/scripts/post-opening-balances.js --dry-run
 *   node apps/backend/dist/scripts/post-opening-balances.js --tenant=<uuid>
 *   node apps/backend/dist/scripts/post-opening-balances.js
 * Locally:
 *   npx tsx scripts/post-opening-balances.ts --dry-run
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { OpeningBackfillReport, OpeningBackfillRow, postImportedOpenings } from '../src/external-sync/opening-balance-backfill';

const prisma = new PrismaClient();

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sumByParty(rows: OpeningBackfillRow[], party: OpeningBackfillRow['party']) {
    const own = rows.filter((row) => row.party === party);
    return { count: own.length, net: own.reduce((sum, row) => sum + row.amount, 0) };
}

function printTenant(name: string, id: string, report: OpeningBackfillReport, dryRun: boolean) {
    const verb = dryRun ? 'would post' : 'posted';
    console.log(`\n  ${name} (${id})`);
    for (const party of ['CUSTOMER', 'SUPPLIER'] as const) {
        const { count, net } = sumByParty(report.posted, party);
        if (count > 0) console.log(`    ${party.toLowerCase()} openings ${verb}: ${count}, net ${money(net)}`);
    }
    if (report.alreadyPosted > 0) console.log(`    already posted: ${report.alreadyPosted}`);
    if (report.skipped.length > 0) console.log(`    skipped, no control account: ${report.skipped.length}`);
    for (const row of report.locked) {
        console.log(`    LOCKED period, not posted: ${row.party.toLowerCase()} ${row.partyId} ${money(row.amount)} on ${row.date.toISOString().slice(0, 10)}`);
    }
    for (const row of report.failed) {
        console.log(`    FAILED: ${row.party.toLowerCase()} ${row.partyId} ${money(row.amount)}: ${row.error}`);
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const tenants = await prisma.tenant.findMany({
        where: tenantId ? { id: tenantId } : {},
        select: { id: true, name: true },
        orderBy: { created_at: 'asc' },
    });
    if (tenantId && tenants.length === 0) {
        console.error(`Tenant ${tenantId} not found.`);
        process.exit(1);
    }

    console.log(`Post imported opening dues (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    let posted = 0;
    let problems = 0;
    for (const tenant of tenants) {
        const report = await postImportedOpenings(prisma, { tenantId: tenant.id, dryRun });
        const touched = report.posted.length + report.skipped.length + report.locked.length + report.failed.length;
        if (touched === 0) continue;

        printTenant(tenant.name, tenant.id, report, dryRun);
        posted += report.posted.length;
        problems += report.locked.length + report.failed.length;
    }

    console.log(`\n${posted} opening(s) ${dryRun ? 'would be posted' : 'posted'}; ${problems} locked or failed.`);
    if (dryRun) console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    if (problems > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
