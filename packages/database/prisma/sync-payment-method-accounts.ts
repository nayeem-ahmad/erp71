/**
 * Links every existing tenant's default payment methods to the default
 * accounts they post to.
 *
 * Why this exists
 * ---------------
 * Until now a payment method's `account_id` was never filled for the seeded
 * defaults, so a tender posted to whatever account its canonical type fell back
 * to, and picking "Nagad" could land in the bank account. Posting now follows
 * the method's own account. `linkDefaultPaymentMethodAccounts` does the linking
 * at signup; this script does it once for tenants that already exist (Cash ->
 * Cash in Hand, Bank and Card -> Main Bank Account, bKash -> bKash Account,
 * Nagad -> Nagad Account).
 *
 * Runs AFTER `db push` (the typed client may use the new columns) and after
 * `sync:accounting`, which creates any default account a tenant is missing.
 *
 * Runs once per database. A deploy runs this on every release, and it links
 * every default-named method that has no account, so repeating it would put
 * back a link an owner cleared on purpose. The first successful whole-database
 * live run therefore stores a marker (`platform_settings`, group `sync`, key
 * `payment_method_accounts`, value = ISO timestamp) and later runs log it and
 * exit 0 without linking. New tenants are linked at signup; a cleared link
 * stays cleared. Pass `--force` to run again anyway.
 *
 * Within a run it only reads methods with no account, never overwrites a link,
 * and skips a name with no matching account. Each tenant runs in its own
 * transaction. `--dry-run` does the same work and rolls it back, so the preview
 * cannot disagree with a live run. A dry run and a `--tenant=` run never write
 * the marker, and a live run writes it only after every tenant succeeded.
 *
 * Usage:
 *   npx tsx prisma/sync-payment-method-accounts.ts --dry-run
 *   npx tsx prisma/sync-payment-method-accounts.ts --tenant=<uuid>
 *   npx tsx prisma/sync-payment-method-accounts.ts
 *   npx tsx prisma/sync-payment-method-accounts.ts --force
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { runPaymentMethodAccountSync } from './sync-payment-method-accounts.utils';

const prisma = new PrismaClient();

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const force = process.argv.includes('--force');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    if (tenantId && !(await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) {
        console.error(`Tenant ${tenantId} not found.`);
        process.exit(1);
    }

    const result = await runPaymentMethodAccountSync(prisma, { dryRun, force, tenantId });

    if (result.skipped) {
        console.log(
            `Sync payment method accounts: already ran at ${result.ranAt}. Skipping ` +
                '(a cleared link stays cleared); pass --force to run again.',
        );
        return;
    }

    console.log(
        `Sync payment method accounts (${dryRun ? 'DRY RUN' : 'LIVE'}${force ? ', FORCED' : ''}) — ` +
            `${result.tenants} tenant(s)`,
    );
    for (const { tenantId: id, linked } of result.changed) {
        console.log(`tenant ${id}: ${dryRun ? 'would link' : 'linked'} ${linked.join(', ')}`);
    }

    if (result.changed.length === 0) {
        console.log(`All ${result.tenants} tenant(s) already up to date. Nothing to do.`);
    } else {
        console.log(`${dryRun ? 'Would sync' : 'Synced'} ${result.changed.length} of ${result.tenants} tenant(s).`);
    }
    if (result.markerWritten) console.log('Recorded the run; later deploys skip this step.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
