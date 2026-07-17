jest.mock('@erp71/database/prisma/bootstrap-accounting', () => ({
    bootstrapDefaultAccountingForTenant: jest.fn(),
    ensureCustomerPaymentPostingSetup: jest.fn(),
}));

import {
    bootstrapDefaultAccountingForTenant,
    ensureCustomerPaymentPostingSetup,
} from '@erp71/database/prisma/bootstrap-accounting';
import { added, applySync, ruleKey, snapshot } from '@erp71/database/prisma/sync-accounting.utils';

const snap = (accounts: string[], rules: string[]) => ({
    accounts: new Set(accounts),
    rules: new Set(rules),
});

describe('sync-accounting — applySync', () => {
    const client = {} as any;

    beforeEach(() => jest.clearAllMocks());

    it('provisions customer-payment rules, which the bootstrap alone does not', async () => {
        // The bootstrap calls ensureLoanPostingSetup and ensureInterBranchAccounts
        // but NOT ensureCustomerPaymentPostingSetup — those rules are otherwise
        // created lazily on a tenant's first customer payment, so a tenant that has
        // never taken one has none at all. If this assertion is ever deleted, the
        // sync silently stops fixing that and nothing else notices.
        await applySync(client, 'tenant-1');

        expect(bootstrapDefaultAccountingForTenant).toHaveBeenCalledWith(client, 'tenant-1');
        expect(ensureCustomerPaymentPostingSetup).toHaveBeenCalledWith(client, 'tenant-1');
    });

    it('runs the bootstrap first, so Accounts Receivable exists before the rules that need it', async () => {
        // ensureCustomerPaymentPostingSetup returns SILENTLY when no 'Accounts
        // Receivable' account exists. Reversing this order would make it a no-op on
        // exactly the stale tenants this script exists to repair.
        const order: string[] = [];
        (bootstrapDefaultAccountingForTenant as jest.Mock).mockImplementation(async () => {
            order.push('bootstrap');
        });
        (ensureCustomerPaymentPostingSetup as jest.Mock).mockImplementation(async () => {
            order.push('customer-payment');
        });

        await applySync(client, 'tenant-1');

        expect(order).toEqual(['bootstrap', 'customer-payment']);
    });
});

describe('sync-accounting — ruleKey', () => {
    it('distinguishes rules that differ only by condition value', () => {
        const bkash = ruleKey({ event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bkash' });
        const nagad = ruleKey({ event_type: 'sale', condition_key: 'payment_mode', condition_value: 'nagad' });

        expect(bkash).not.toBe(nagad);
    });

    it('does not collide a null condition_value with the literal string "-"', () => {
        // Both render as 'purchase_return/none/-' if null is naively stringified,
        // which would report a missing rule as present.
        const nullValue = ruleKey({ event_type: 'purchase_return', condition_key: 'none', condition_value: null });

        expect(nullValue).toBe('purchase_return/none/-');
    });
});

describe('sync-accounting — added', () => {
    it('reports only what the sync would newly create', () => {
        const before = snap(['Cash in Hand'], ['sale/payment_mode/cash']);
        const after = snap(
            ['Cash in Hand', 'bKash Account'],
            ['sale/payment_mode/cash', 'sale/payment_mode/bkash'],
        );

        expect(added(before, after)).toEqual({
            accounts: ['bKash Account'],
            rules: ['sale/payment_mode/bkash'],
        });
    });

    it('reports nothing for an already-current tenant', () => {
        const current = snap(['Cash in Hand'], ['sale/payment_mode/cash']);

        expect(added(current, current)).toEqual({ accounts: [], rules: [] });
    });

    it('never reports removals — the sync is additive-only', () => {
        const before = snap(['Cash in Hand', 'Retired Account'], ['sale/payment_mode/cash']);
        const after = snap(['Cash in Hand'], []);

        expect(added(before, after)).toEqual({ accounts: [], rules: [] });
    });
});

describe('sync-accounting — snapshot', () => {
    it('keys posting rules so bkash and nagad are not conflated', async () => {
        const client = {
            account: { findMany: jest.fn().mockResolvedValue([{ name: 'bKash Account' }]) },
            postingRule: {
                findMany: jest.fn().mockResolvedValue([
                    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bkash' },
                    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'nagad' },
                ]),
            },
        } as any;

        const result = await snapshot(client, 'tenant-1');

        expect(result.accounts).toEqual(new Set(['bKash Account']));
        expect(result.rules).toEqual(new Set(['sale/payment_mode/bkash', 'sale/payment_mode/nagad']));
    });

    it('scopes both queries to the tenant', async () => {
        const client = {
            account: { findMany: jest.fn().mockResolvedValue([]) },
            postingRule: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        await snapshot(client, 'tenant-1');

        expect(client.account.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
        );
        expect(client.postingRule.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
        );
    });
});
