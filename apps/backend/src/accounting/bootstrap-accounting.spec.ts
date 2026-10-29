import { bootstrapDefaultAccountingForTenant, DEFAULT_ACCOUNTING_TEMPLATE } from '@erp71/database';

describe('bootstrapDefaultAccountingForTenant — Story 30.2', () => {
    it('upserts the default account skeleton without failing on rerun', async () => {
        const accountGroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        };
        const accountSubgroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        };
        const account = {
            update: jest.fn().mockResolvedValue({ id: 'account-id' }),
            create: jest.fn().mockResolvedValue({ id: 'account-id' }),
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
        expect(account.update).toHaveBeenCalled();
        expect(account.update.mock.calls.length).toBeGreaterThanOrEqual(5);
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
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        };
        const accountSubgroup = {
            upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                id: `${create.name}-id`,
                ...create,
            })),
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        };
        const account = {
            update: jest.fn().mockResolvedValue({ id: 'account-id' }),
            create: jest.fn().mockResolvedValue({ id: 'account-id' }),
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

    it('stamps Cash in Hand with the first store and leaves the bank shared', async () => {
        const account = {
            update: jest.fn().mockResolvedValue({ id: 'account-id' }),
            create: jest.fn().mockResolvedValue({ id: 'account-id' }),
            findFirst: jest.fn().mockImplementation(async ({ where }: { where: { name?: string; store_id?: string | null } }) => {
                if (where?.name === 'Cash in Hand' && where.store_id === null) return { id: 'cash-id', name: 'Cash in Hand' };
                if (where?.store_id === 's1' && !where?.name) return null;
                if (where?.name) return { id: `${where.name}-id` };
                return null;
            }),
            findMany: jest.fn().mockResolvedValue([
                { id: 'cash-id', name: 'Cash in Hand' },
                { id: 'bank-id', name: 'Main Bank Account' },
                { id: 'revenue-id', name: 'Sales Revenue' },
                { id: 'payable-id', name: 'Purchase Payable' },
                { id: 'expense-id', name: 'General Operating Expense' },
            ]),
        };
        const db = {
            accountGroup: {
                upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: `${create.name}-id`, ...create })),
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            accountSubgroup: {
                upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: `${create.name}-id`, ...create })),
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            account,
            postingRule: {
                findFirst: jest.fn().mockResolvedValue({ id: 'existing-rule-id' }),
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({ id: 'rule-id' }),
            },
            store: {
                findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
            },
        } as any;

        await bootstrapDefaultAccountingForTenant(db, 'tenant-1');

        expect(account.update).toHaveBeenCalledWith({
            where: { id: 'cash-id' },
            data: { store_id: 's1' },
        });
        const bankStamp = account.update.mock.calls.find((call: any[]) => call[0]?.data?.store_id && call[0]?.where?.id === 'bank-id');
        expect(bankStamp).toBeUndefined();
    });

    it('does not mint a second Cash in Hand after the first store already has a drawer', async () => {
        // Production after the first post-branch-books deploy: Cash in Hand is
        // already the signup branch's drawer. A later sync:accounting must not
        // create a shared row of the same name and then stamp it onto that store
        // — that unique-constraint is what aborted the 2026-10-29 employee-save
        // deploy (run 40920975122).
        const accounts = [
            { id: 'cash-id', name: 'Cash in Hand', store_id: 's1', code: '110101' },
            { id: 'bank-id', name: 'Main Bank Account', store_id: null, code: '110102' },
            { id: 'revenue-id', name: 'Sales Revenue', store_id: null },
            { id: 'payable-id', name: 'Purchase Payable', store_id: null },
            { id: 'expense-id', name: 'General Operating Expense', store_id: null },
        ];
        const account = {
            update: jest.fn().mockResolvedValue({ id: 'account-id' }),
            create: jest.fn().mockResolvedValue({ id: 'account-id' }),
            findFirst: jest.fn().mockImplementation(async ({ where }: { where: { name?: string; store_id?: string | null } }) => {
                if (where?.store_id === 's1' && !where?.name) {
                    return accounts.find((row) => row.store_id === 's1') ?? null;
                }
                if (where?.name && where.store_id === null) {
                    return accounts.find((row) => row.name === where.name && row.store_id == null) ?? null;
                }
                if (where?.name) {
                    return accounts.find((row) => row.name === where.name) ?? null;
                }
                return null;
            }),
            findMany: jest.fn().mockResolvedValue(accounts),
        };
        const db = {
            accountGroup: {
                upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: `${create.name}-id`, ...create })),
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            accountSubgroup: {
                upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: `${create.name}-id`, ...create })),
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            account,
            postingRule: {
                findFirst: jest.fn().mockResolvedValue({ id: 'existing-rule-id' }),
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({ id: 'rule-id' }),
            },
            store: {
                findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
            },
        } as any;

        await bootstrapDefaultAccountingForTenant(db, 'tenant-1');

        expect(account.create.mock.calls.some((call: any[]) => call[0]?.data?.name === 'Cash in Hand')).toBe(false);
        expect(account.update.mock.calls.some((call: any[]) => call[0]?.data?.store_id === 's1')).toBe(false);
    });
});

describe('DEFAULT_ACCOUNTING_TEMPLATE — chart of accounts', () => {
    const allAccounts = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group) =>
        group.subgroups.flatMap((subgroup) => subgroup.accounts),
    );

    it.each([
        ['Accounts Receivable', '110201'],
        ['bKash Account', '110103'],
        ['Nagad Account', '110104'],
        ['Purchases', '510101'],
        ['Loans Receivable', '110301'],
    ])('provisions %s at code %s', (name, code) => {
        const account = allAccounts.find((a) => a.name === name);
        expect(account).toBeDefined();
        expect(account?.code).toBe(code);
    });

    it('assigns every account code exactly once', () => {
        const codes = allAccounts.map((a) => a.code).filter(Boolean);
        expect(codes).toHaveLength(new Set(codes).size);
    });

    it('gives every group and subgroup a unique code too', () => {
        const groupCodes = DEFAULT_ACCOUNTING_TEMPLATE.map((g) => g.code);
        const subgroupCodes = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((g) =>
            g.subgroups.map((s) => s.code),
        );
        expect(groupCodes).toHaveLength(new Set(groupCodes).size);
        expect(subgroupCodes).toHaveLength(new Set(subgroupCodes).size);
    });

    it('prefixes every subgroup with its group and every account with its subgroup', () => {
        for (const group of DEFAULT_ACCOUNTING_TEMPLATE) {
            expect(group.code).toHaveLength(2);
            for (const subgroup of group.subgroups) {
                expect(subgroup.code).toHaveLength(4);
                expect(subgroup.code.startsWith(group.code)).toBe(true);
                for (const account of subgroup.accounts) {
                    expect(account.code).toHaveLength(6);
                    expect(account.code.startsWith(subgroup.code)).toBe(true);
                }
            }
        }
    });

    it('opens every group code with the digit for its type', () => {
        const digits: Record<string, string> = {
            asset: '1',
            liability: '2',
            equity: '3',
            revenue: '4',
            expense: '5',
        };
        for (const group of DEFAULT_ACCOUNTING_TEMPLATE) {
            expect(group.code[0]).toBe(digits[group.type]);
        }
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
