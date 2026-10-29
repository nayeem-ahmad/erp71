import { ensureBranchCashDrawer } from '@erp71/database';

/**
 * A later branch gets one cash drawer and one Cash method. Banks and wallets
 * stay the shared ones from signup.
 */
describe('ensureBranchCashDrawer', () => {
    const storeId = '501fed1b-9732-44fa-98b1-271fae2bc135';

    function client(overrides: {
        drawer?: { id: string } | null;
        method?: { id: string } | null;
        takenNames?: string[];
    } = {}) {
        const createdAccounts: Record<string, unknown>[] = [];
        const createdMethods: Record<string, unknown>[] = [];
        const storeRows: Record<string, unknown>[] = [];
        const tx = {
            account: {
                findFirst: jest.fn().mockResolvedValue(overrides.drawer ?? null),
                findMany: jest.fn().mockResolvedValue([{ code: '110101' }, { code: '110102' }, { code: '110103' }, { code: '110104' }]),
                create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                    createdAccounts.push(data);
                    return { id: 'drawer-new', ...data };
                }),
            },
            accountGroup: {
                findFirst: jest.fn().mockResolvedValue({ id: 'g-asset', code: '11' }),
            },
            accountSubgroup: {
                findFirst: jest.fn().mockResolvedValue({ id: 'sg-cash', code: '1101', group_id: 'g-asset' }),
            },
            store: {
                findFirst: jest.fn().mockResolvedValue({ id: storeId, name: 'Press Club', code: 'LT' }),
            },
            paymentMethod: {
                findMany: jest.fn().mockResolvedValue((overrides.takenNames ?? ['Cash', 'Bank', 'bKash', 'Nagad', 'Card']).map((name) => ({ name }))),
                findFirst: jest.fn().mockResolvedValue(overrides.method ?? null),
                create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                    createdMethods.push(data);
                    return { id: 'pm-new', ...data };
                }),
            },
            paymentMethodStore: {
                create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                    storeRows.push(data);
                    return { id: 'row', ...data };
                }),
            },
        };
        return { tx, createdAccounts, createdMethods, storeRows };
    }

    it('creates one drawer for that branch and one Cash method limited to it', async () => {
        const { tx, createdAccounts, createdMethods, storeRows } = client();

        const result = await ensureBranchCashDrawer(tx, 't1', storeId);

        expect(createdAccounts.map((row) => row.name)).toEqual(['Cash in Hand']);
        expect(createdAccounts[0]).toMatchObject({
            tenant_id: 't1',
            category: 'cash',
            store_id: storeId,
        });
        expect(createdAccounts.map((row) => row.name)).not.toEqual(expect.arrayContaining(['Main Bank Account', 'bKash Account']));
        expect(createdMethods).toHaveLength(1);
        expect(createdMethods[0]).toMatchObject({
            type: 'Cash',
            name: 'Cash (Press Club)',
            all_branches: false,
            account_id: 'drawer-new',
        });
        expect(storeRows).toEqual([
            { tenant_id: 't1', payment_method_id: 'pm-new', store_id: storeId },
        ]);
        expect(result).toEqual({ accountId: 'drawer-new', methodId: 'pm-new' });
    });

    it('does not create another drawer when the branch already has one', async () => {
        const { tx, createdAccounts, createdMethods } = client({
            drawer: { id: 'drawer-existing' },
            method: { id: 'pm-existing' },
        });

        await expect(ensureBranchCashDrawer(tx, 't1', storeId)).resolves.toEqual({
            accountId: 'drawer-existing',
            methodId: 'pm-existing',
        });
        expect(createdAccounts).toEqual([]);
        expect(createdMethods).toEqual([]);
    });
});
