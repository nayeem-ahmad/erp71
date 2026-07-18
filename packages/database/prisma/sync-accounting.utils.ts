/**
 * The testable core of sync-accounting.ts. Kept separate so the CLI can run
 * main() at module scope (as repair-fabricated-vouchers.ts does) while this half
 * stays importable — see repair-fabricated-vouchers.utils.ts for the same split.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { bootstrapDefaultAccountingForTenant } from './bootstrap-accounting';

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
    // customer_payment and loan rules are now plain DEFAULT_POSTING_RULES entries
    // (they used to be provisioned lazily by ensure* helpers), so the bootstrap
    // alone brings a tenant fully up to date.
    await bootstrapDefaultAccountingForTenant(client, tenantId);
}
