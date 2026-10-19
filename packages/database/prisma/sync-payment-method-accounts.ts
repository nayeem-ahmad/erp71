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
 * Idempotent and additive-only: it reads only methods with no account, never
 * overwrites a link an owner chose, and skips a name with no matching account.
 * Each tenant runs in its own transaction. `--dry-run` does the same work and
 * rolls it back, so the preview cannot disagree with a live run.
 *
 * Usage:
 *   npx tsx prisma/sync-payment-method-accounts.ts --dry-run
 *   npx tsx prisma/sync-payment-method-accounts.ts --tenant=<uuid>
 *   npx tsx prisma/sync-payment-method-accounts.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { linkDefaultPaymentMethodAccounts } from './payment-method.seed';

const prisma = new PrismaClient();

/** Thrown to abort the dry-run transaction. Never escapes linkTenant. */
class Rollback extends Error {}

async function linkTenant(tenantId: string, dryRun: boolean): Promise<string[]> {
    let linked: string[] = [];

    try {
        await prisma.$transaction(
            async (tx) => {
                ({ linked } = await linkDefaultPaymentMethodAccounts(tx, tenantId));
                if (dryRun) throw new Rollback();
            },
            { timeout: 30_000 },
        );
    } catch (error) {
        if (!(error instanceof Rollback)) throw error;
    }

    return linked;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const tenants = await prisma.tenant.findMany({
        where: tenantId ? { id: tenantId } : undefined,
        select: { id: true },
        orderBy: { created_at: 'asc' },
    });
    if (tenantId && tenants.length === 0) {
        console.error(`Tenant ${tenantId} not found.`);
        process.exit(1);
    }

    console.log(`Sync payment method accounts (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    let changed = 0;
    for (const tenant of tenants) {
        const linked = await linkTenant(tenant.id, dryRun);
        if (linked.length === 0) continue;

        changed += 1;
        console.log(`tenant ${tenant.id}: ${dryRun ? 'would link' : 'linked'} ${linked.join(', ')}`);
    }

    if (changed === 0) {
        console.log(`All ${tenants.length} tenant(s) already up to date. Nothing to do.`);
        return;
    }
    console.log(`${dryRun ? 'Would sync' : 'Synced'} ${changed} of ${tenants.length} tenant(s).`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
