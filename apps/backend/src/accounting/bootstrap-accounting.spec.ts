import { bootstrapDefaultAccountingForTenant, DEFAULT_ACCOUNTING_TEMPLATE } from '@erp71/database';

describe('bootstrapDefaultAccountingForTenant — Story 30.2', () => {
    it('upserts the default account skeleton without failing on rerun', async () => {
        const accountGroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
        };
        const accountSubgroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
        };
        const account = {
            upsert: jest.fn().mockResolvedValue({ id: 'account-id' }),
            findFirst: jest.fn().mockResolvedValue({ id: 'cash-id' }),
            findMany: jest.fn().mockResolvedValue([
                { id: 'cash-id', name: 'Cash in Hand' },
                { id: 'bank-id', name: 'Main Bank Account' },
                { id: 'revenue-id', name: 'Sales Revenue' },
                { id: 'payable-id', name: 'Purchase Payable' },
                { id: 'expense-id', name: 'General Operating Expense' },
            ]),
        };
        const postingRule = {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'rule-id' }),
            update: jest.fn().mockResolvedValue({ id: 'rule-id' }),
        };

        const db = {
            accountGroup,
            accountSubgroup,
            account,
            postingRule,
        } as any;

        await bootstrapDefaultAccountingForTenant(db, 'tenant-1');
        await bootstrapDefaultAccountingForTenant(db, 'tenant-1');

        expect(accountGroup.upsert).toHaveBeenCalled();
        expect(accountSubgroup.upsert).toHaveBeenCalled();
        expect(account.upsert).toHaveBeenCalled();
        expect(account.upsert.mock.calls.length).toBeGreaterThanOrEqual(5);
        expect(account.findMany).toHaveBeenCalled();
        expect(postingRule.create).toHaveBeenCalled();
    });

    it('updates existing posting rules instead of creating duplicates on rerun', async () => {
        const existingRule = { id: 'existing-rule-id' };
        const accountGroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
        };
        const accountSubgroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
        };
        const account = {
            upsert: jest.fn().mockResolvedValue({ id: 'account-id' }),
            findFirst: jest.fn().mockResolvedValue({ id: 'cash-id' }),
            findMany: jest.fn().mockResolvedValue([
                { id: 'cash-id', name: 'Cash in Hand' },
                { id: 'bank-id', name: 'Main Bank Account' },
                { id: 'revenue-id', name: 'Sales Revenue' },
                { id: 'payable-id', name: 'Purchase Payable' },
                { id: 'expense-id', name: 'General Operating Expense' },
            ]),
        };
        const postingRule = {
            findFirst: jest.fn().mockResolvedValue(existingRule),
            create: jest.fn().mockResolvedValue({ id: 'rule-id' }),
            update: jest.fn().mockResolvedValue({ id: 'rule-id' }),
        };

        const db = {
            accountGroup,
            accountSubgroup,
            account,
            postingRule,
        } as any;

        await bootstrapDefaultAccountingForTenant(db, 'tenant-1');

        expect(postingRule.update).toHaveBeenCalled();
        expect(postingRule.create).not.toHaveBeenCalled();
    });
});

describe('DEFAULT_ACCOUNTING_TEMPLATE — chart of accounts', () => {
    const allAccounts = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group) =>
        group.subgroups.flatMap((subgroup) => subgroup.accounts),
    );

    it.each([
        ['Accounts Receivable', '1030'],
        ['bKash Account', '1015'],
        ['Nagad Account', '1016'],
        ['Purchases', '5015'],
        ['Loans Receivable', '1035'],
    ])('provisions %s at code %s', (name, code) => {
        const account = allAccounts.find((a) => a.name === name);
        expect(account).toBeDefined();
        expect(account?.code).toBe(code);
    });

    it('assigns every account code exactly once', () => {
        const codes = allAccounts.map((a) => a.code).filter(Boolean);
        expect(codes).toHaveLength(new Set(codes).size);
    });

    it.each([
        'Stock on Hand',
        'Goods in Transit',
        'Cost of Goods Sold',
        'Rocket Account',
    ])('does not provision %s (unused under periodic inventory)', (name) => {
        expect(allAccounts.find((a) => a.name === name)).toBeUndefined();
    });
});
