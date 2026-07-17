/**
 * The testable core of sync-accounting.ts. Kept separate so the CLI can run
 * main() at module scope (as repair-fabricated-vouchers.ts does) while this half
 * stays importable — see repair-fabricated-vouchers.utils.ts for the same split.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
    bootstrapDefaultAccountingForTenant,
    ensureCustomerPaymentPostingSetup,
} from './bootstrap-accounting';

export type SyncClient = PrismaClient | Prisma.TransactionClient;

export type Snapshot = { accounts: Set<string>; rules: Set<string> };
export type Delta = { accounts: string[]; rules: string[] };

export const ruleKey = (rule: {
    event_type: string;
    condition_key: string;
    condition_value: string | null;
}) => `${rule.event_type}/${rule.condition_key}/${rule.condition_value ?? '-'}`;

export async function snapshot(client: SyncClient, tenantId: string): Promise<Snapshot> {
    const [accounts, rules] = await Promise.all([
        client.account.findMany({ where: { tenant_id: tenantId }, select: { name: true } }),
        client.postingRule.findMany({
            where: { tenant_id: tenantId },
            select: { event_type: true, condition_key: true, condition_value: true },
        }),
    ]);

    return {
        accounts: new Set(accounts.map((account) => account.name)),
        rules: new Set(rules.map(ruleKey)),
    };
}

/**
 * Sorted, because the dry run is the review gate: an operator compares its output
 * against the live run's. Set iteration follows insertion order, which differs
 * between the rolled-back preview transaction and the live one, so an unsorted
 * delta reports the same rules in a different order and reads as a discrepancy.
 */
export const added = (before: Snapshot, after: Snapshot): Delta => ({
    accounts: [...after.accounts]
        .filter((name) => !before.accounts.has(name))
        .sort((a, b) => a.localeCompare(b)),
    rules: [...after.rules]
        .filter((key) => !before.rules.has(key))
        .sort((a, b) => a.localeCompare(b)),
});

/**
 * The whole sync, for one tenant. Both the dry-run preview and the live path call
 * this, so the two cannot disagree about what a sync does.
 */
export async function applySync(client: SyncClient, tenantId: string): Promise<void> {
    await bootstrapDefaultAccountingForTenant(client, tenantId);

    // MUST be called explicitly and MUST come second.
    //
    // The bootstrap does NOT call this — it only calls ensureLoanPostingSetup and
    // ensureInterBranchAccounts. customer_payment rules are otherwise provisioned
    // lazily, on a tenant's first customer payment (customers.service.ts:564,643),
    // so a tenant that has never taken one has no rules for it at all. Verified
    // against a real database: all three local tenants were missing them.
    //
    // It also depends on an 'Accounts Receivable' account and returns SILENTLY if
    // one does not exist, so running it before the bootstrap would be a no-op on
    // exactly the stale tenants this script exists to fix.
    await ensureCustomerPaymentPostingSetup(client, tenantId);
}
