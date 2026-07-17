/**
 * Brings every existing tenant's chart of accounts and posting rules up to the
 * current defaults.
 *
 * Why this exists
 * ---------------
 * `bootstrapDefaultAccountingForTenant` runs ONLY at tenant creation
 * (`auth.service.ts:591`, `admin-tenants.service.ts:781`). Nothing re-runs it. So
 * every time `DEFAULT_ACCOUNTING_TEMPLATE` or `DEFAULT_POSTING_RULES` gains an
 * entry, existing tenants silently never receive it — and `autoPostFromRules`
 * SKIPS (posts nothing) when no rule matches. That is not a loud failure: revenue
 * simply stops reaching the ledger.
 *
 * This already happened once. Commit `9ffb067` (2026-07-16) added the
 * bkash/nagad/credit sale rules AND fixed `classifyPaymentMode` to stop
 * collapsing wallets into `bank`. On any tenant created before that date, a bKash
 * sale now classifies as `bkash`, finds no rule, and posts nothing — while cash
 * and card sales post fine. Running this script fixes those tenants.
 *
 * Not the same thing as `repair:vouchers`
 * ---------------------------------------
 * `repair-fabricated-vouchers.ts` also re-runs the bootstrap, but it additionally
 * DELETES rules and vouchers. It is a one-time, destructive, human-reviewed
 * migration. This script is additive-only and idempotent, so it is safe to run on
 * every deploy — which is the point: it is what stops the drift recurring.
 *
 * Usage:
 *   npx tsx prisma/sync-accounting.ts --dry-run
 *   npx tsx prisma/sync-accounting.ts --tenant=<uuid>
 *   npx tsx prisma/sync-accounting.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { applySync, added, snapshot, Delta } from './sync-accounting.utils';

const prisma = new PrismaClient();

/** Thrown to abort the dry-run transaction. Never escapes previewTenant. */
class Rollback extends Error {}

/**
 * Reports exactly what a live run would add, by performing one and rolling it back.
 *
 * Deliberately not a name-diff against DEFAULT_POSTING_RULES: the loan,
 * inter-branch and customer-payment rules are created by the ensure* helpers
 * rather than declared in that array, so a name-diff silently under-reports them
 * and the preview would promise "nothing to do" before a live run that writes.
 * Executing the real thing and discarding it is accurate by construction.
 */
async function previewTenant(tenantId: string): Promise<Delta> {
    let delta: Delta = { accounts: [], rules: [] };

    try {
        await prisma.$transaction(
            async (tx) => {
                const before = await snapshot(tx, tenantId);
                await applySync(tx, tenantId);
                delta = added(before, await snapshot(tx, tenantId));
                throw new Rollback();
            },
            { timeout: 30_000 },
        );
    } catch (error) {
        if (!(error instanceof Rollback)) throw error;
    }

    return delta;
}

async function syncTenant(tenantId: string): Promise<Delta> {
    return prisma.$transaction(
        async (tx) => {
            const before = await snapshot(tx, tenantId);
            await applySync(tx, tenantId);
            return added(before, await snapshot(tx, tenantId));
        },
        { timeout: 30_000 },
    );
}

async function loadTenants(tenantId?: string) {
    if (!tenantId) {
        return prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } });
    }

    const tenants = await prisma.tenant.findMany({
        where: { id: tenantId },
        select: { id: true, name: true },
    });
    if (tenants.length === 0) {
        console.error(`Tenant ${tenantId} not found.`);
        process.exit(1);
    }
    return tenants;
}

function reportTenant(tenant: { id: string; name: string }, delta: Delta, dryRun: boolean) {
    const verb = dryRun ? 'would add' : 'added';
    console.log(`\n  ${tenant.name} (${tenant.id})`);
    if (delta.accounts.length > 0) {
        console.log(`    ${verb} accounts: ${delta.accounts.join(', ')}`);
    }
    if (delta.rules.length > 0) {
        console.log(`    ${verb} rules:    ${delta.rules.join(', ')}`);
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
    const tenants = await loadTenants(tenantId);

    console.log(`Sync accounting defaults (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    const changed: Delta[] = [];

    for (const tenant of tenants) {
        const delta = dryRun ? await previewTenant(tenant.id) : await syncTenant(tenant.id);
        if (delta.accounts.length === 0 && delta.rules.length === 0) continue;

        changed.push(delta);
        reportTenant(tenant, delta, dryRun);
    }

    if (changed.length === 0) {
        console.log(`\nAll ${tenants.length} tenant(s) already up to date. Nothing to do.`);
        return;
    }

    const totalAccounts = changed.reduce((sum, delta) => sum + delta.accounts.length, 0);
    const totalRules = changed.reduce((sum, delta) => sum + delta.rules.length, 0);

    console.log(
        `\n${dryRun ? 'Would sync' : 'Synced'} ${changed.length} of ${tenants.length} tenant(s): ` +
        `${totalAccounts} account(s), ${totalRules} rule(s).`,
    );
    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
