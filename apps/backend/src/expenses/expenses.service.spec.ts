import { BadRequestException, NotFoundException } from '@nestjs/common';
import { autoPostFromRules } from '../accounting/posting.utils';
import { ExpensesService } from './expenses.service';

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({
        postingStatus: 'posted',
        voucherId: null,
        voucherNumber: null,
        voucherType: null,
    }),
}));

describe('ExpensesService', () => {
    let service: ExpensesService;
    let db: {
        expenseEntry: { findMany: jest.Mock; count: jest.Mock };
    };

    beforeEach(() => {
        db = {
            expenseEntry: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
        };
        service = new ExpensesService(db as any);
    });

    it('listEntries() should filter created_at to the inclusive Dhaka day range', async () => {
        await service.listEntries('tenant-1', { timezone: 'Asia/Dhaka',
            page: 1,
            limit: 20,
            createdFrom: '2026-08-19',
            createdTo: '2026-08-19',
        });

        expect(db.expenseEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    created_at: {
                        gte: new Date('2026-08-18T18:00:00.000Z'),
                        lte: new Date('2026-08-19T17:59:59.999Z'),
                    },
                }),
            }),
        );
    });

    it('listEntries() filters by expense head', async () => {
        await service.listEntries('tenant-1', {
            timezone: 'Asia/Dhaka',
            page: 1,
            limit: 20,
            headId: 'head-1',
        });

        expect(db.expenseEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1', head_id: 'head-1' }),
                include: expect.objectContaining({ head: true, category: true }),
            }),
        );
    });

    it('createEntry() stores the head and copies its category', async () => {
        const tx = {
            expenseEntry: {
                create: jest.fn().mockResolvedValue({
                    id: 'entry-1',
                    amount: 500,
                    expense_date: new Date('2026-10-01'),
                    description: 'October',
                    store_id: null,
                }),
            },
        };
        const heads = {
            expenseHead: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'head-1',
                    category_id: 'cat-salary',
                    tenant_id: 'tenant-1',
                    category: { account_id: null },
                }),
            },
            $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        };
        const local = new ExpensesService(heads as any);

        await local.createEntry('tenant-1', 'user-1', {
            headId: 'head-1',
            amount: 500,
            expenseDate: '2026-10-01',
            description: 'October',
        });

        expect(tx.expenseEntry.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    category_id: 'cat-salary',
                    head_id: 'head-1',
                    amount: 500,
                }),
            }),
        );
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.not.objectContaining({ overrideDebitAccountId: expect.anything() }),
        );
    });

    it('createEntry() charges the category account when one is connected', async () => {
        const tx = {
            expenseEntry: {
                create: jest.fn().mockResolvedValue({
                    id: 'entry-1',
                    amount: 1200,
                    expense_date: new Date('2026-10-01'),
                    description: null,
                    store_id: null,
                }),
            },
        };
        const heads = {
            expenseHead: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'head-1',
                    category_id: 'cat-rent',
                    tenant_id: 'tenant-1',
                    category: { account_id: 'acct-rent' },
                }),
            },
            $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        };
        const local = new ExpensesService(heads as any);

        await local.createEntry('tenant-1', 'user-1', {
            headId: 'head-1',
            amount: 1200,
            expenseDate: '2026-10-01',
        });

        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ overrideDebitAccountId: 'acct-rent', conditionValue: 'cash' }),
        );
    });

    it('createEntry() prefers the head account over the category account', async () => {
        const tx = {
            expenseEntry: {
                create: jest.fn().mockResolvedValue({
                    id: 'entry-1',
                    amount: 800,
                    expense_date: new Date('2026-10-01'),
                    description: null,
                    store_id: null,
                }),
            },
        };
        const heads = {
            expenseHead: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'head-karim',
                    account_id: 'acct-karim',
                    category_id: 'cat-salary',
                    tenant_id: 'tenant-1',
                    category: { account_id: 'acct-salary' },
                }),
            },
            $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        };
        const local = new ExpensesService(heads as any);

        await local.createEntry('tenant-1', 'user-1', {
            headId: 'head-karim',
            amount: 800,
            expenseDate: '2026-10-01',
        });

        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ overrideDebitAccountId: 'acct-karim' }),
        );
    });

    it('createHead() stores an expense account and can clear it back to the category', async () => {
        const heads = {
            expenseCategory: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', tenant_id: 'tenant-1' }),
            },
            expenseHead: {
                findFirst: jest.fn()
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({ id: 'head-1', category_id: 'cat-1', name: 'Salary - Karim', tenant_id: 'tenant-1' }),
                create: jest.fn().mockResolvedValue({ id: 'head-1' }),
                update: jest.fn().mockResolvedValue({ id: 'head-1' }),
            },
            account: {
                findFirst: jest.fn().mockResolvedValue({ id: 'acct-karim', tenant_id: 'tenant-1', type: 'expense' }),
            },
        };
        const local = new ExpensesService(heads as any);

        await local.createHead('tenant-1', {
            categoryId: 'cat-1',
            name: 'Salary - Karim',
            accountId: 'acct-karim',
        });
        expect(heads.expenseHead.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ account_id: 'acct-karim' }),
            }),
        );

        await local.updateHead('tenant-1', 'head-1', { accountId: null });
        expect(heads.expenseHead.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ account_id: null }),
            }),
        );
    });

    it('createCategory() stores an expense account and rejects anything else', async () => {
        const categories = {
            expenseCategory: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'cat-1' }),
            },
            account: {
                findFirst: jest.fn()
                    .mockResolvedValueOnce({ id: 'acct-rent', tenant_id: 'tenant-1', type: 'expense' })
                    .mockResolvedValueOnce({ id: 'acct-cash', tenant_id: 'tenant-1', type: 'asset' }),
            },
        };
        const local = new ExpensesService(categories as any);

        await local.createCategory('tenant-1', { name: 'Rent', accountId: 'acct-rent' });
        expect(categories.expenseCategory.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ name: 'Rent', account_id: 'acct-rent' }),
            }),
        );

        await expect(
            local.createCategory('tenant-1', { name: 'Rent', accountId: 'acct-cash' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updateCategory() clears the account when accountId is null', async () => {
        const categories = {
            expenseCategory: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', tenant_id: 'tenant-1' }),
                update: jest.fn().mockResolvedValue({ id: 'cat-1' }),
            },
        };
        const local = new ExpensesService(categories as any);

        await local.updateCategory('tenant-1', 'cat-1', { accountId: null });

        expect(categories.expenseCategory.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ account_id: null }),
            }),
        );
    });

    it('createEntry() rejects a head from another tenant', async () => {
        const heads = {
            expenseHead: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const local = new ExpensesService(heads as any);

        await expect(
            local.createEntry('tenant-1', 'user-1', {
                headId: 'missing',
                amount: 10,
                expenseDate: '2026-10-01',
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deleteHead() refuses a head that has entries', async () => {
        const heads = {
            expenseHead: {
                findFirst: jest.fn().mockResolvedValue({ id: 'head-1', _count: { entries: 2 } }),
            },
        };
        const local = new ExpensesService(heads as any);

        await expect(local.deleteHead('tenant-1', 'head-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deleteCategory() refuses a category that still has heads', async () => {
        const categories = {
            expenseCategory: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', _count: { entries: 0, heads: 1 } }),
            },
        };
        const local = new ExpensesService(categories as any);

        await expect(local.deleteCategory('tenant-1', 'cat-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('getSummary() totals by category and splits each category by head', async () => {
        const summaryDb = {
            expenseEntry: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        category_id: 'cat-salary',
                        head_id: 'head-karim',
                        amount: 300,
                        expense_date: new Date('2026-10-01'),
                        category: { id: 'cat-salary', name: 'Salary' },
                        head: { id: 'head-karim', name: 'Salary - Karim' },
                    },
                    {
                        category_id: 'cat-salary',
                        head_id: 'head-rahim',
                        amount: 100,
                        expense_date: new Date('2026-10-02'),
                        category: { id: 'cat-salary', name: 'Salary' },
                        head: { id: 'head-rahim', name: 'Salary - Rahim' },
                    },
                ]),
            },
            sale: { aggregate: jest.fn().mockResolvedValue({ _sum: { total_amount: 1000 } }) },
        };
        const local = new ExpensesService(summaryDb as any);

        const summary = await local.getSummary('tenant-1', {});

        expect(summary.total).toBe(400);
        expect(summary.byCategory).toEqual([
            expect.objectContaining({
                categoryId: 'cat-salary',
                name: 'Salary',
                amount: 400,
                sharePct: 100,
                heads: [
                    expect.objectContaining({ headId: 'head-karim', name: 'Salary - Karim', amount: 300, sharePct: 75 }),
                    expect.objectContaining({ headId: 'head-rahim', name: 'Salary - Rahim', amount: 100, sharePct: 25 }),
                ],
            }),
        ]);
    });
});
