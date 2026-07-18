jest.mock('@erp71/database/prisma/bootstrap-accounting', () => ({
    bootstrapDefaultAccountingForTenant: jest.fn(),
}));

import { bootstrapDefaultAccountingForTenant } from '@erp71/database/prisma/bootstrap-accounting';
import { added, applySync, ruleKey, snapshot } from '@erp71/database/prisma/sync-accounting.utils';

const snap = (accounts: string[], rules: string[]) => ({
    accounts: new Set(accounts),
    rules: new Set(rules),
});

describe('sync-accounting — applySync', () => {
    const client = {} as any;

    beforeEach(() => jest.clearAllMocks());

    it('brings a tenant up to date through the bootstrap alone', async () => {
        // customer_payment and loan rules are now plain DEFAULT_POSTING_RULES
        // entries (not lazy ensure* helpers), so the bootstrap provisions the whole
        // default set — one mechanism.
        await applySync(client, 'tenant-1');

        expect(bootstrapDefaultAccountingForTenant).toHaveBeenCalledWith(client, 'tenant-1');
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
