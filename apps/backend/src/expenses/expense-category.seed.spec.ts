/**
 * The seed the backend loads is the hand-written CommonJS file. The TypeScript
 * source is what new code is edited in. Both have to insert the same categories.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const expenseCategorySeed = require('../../../../packages/database/prisma/expense-category.seed.ts');
const expenseCategoryPackage = require('@erp71/database');

function fakeTx(existing: { id: string; heads: number } | null) {
    return {
        expenseCategory: {
            findUnique: jest.fn().mockResolvedValue(
                existing ? { id: existing.id, _count: { heads: existing.heads } } : null,
            ),
            create: jest.fn(async ({ data }: { data: { name: string } }) => ({ id: `cat-${data.name}`, ...data })),
        },
        expenseHead: {
            create: jest.fn(async ({ data }: { data: { name: string } }) => data),
        },
    };
}

describe.each([
    ['source', expenseCategorySeed.seedDefaultExpenseCategories, expenseCategorySeed.DEFAULT_EXPENSE_CATEGORIES],
    ['runtime', expenseCategoryPackage.seedDefaultExpenseCategories, expenseCategoryPackage.DEFAULT_EXPENSE_CATEGORIES],
])('seedDefaultExpenseCategories (%s)', (_label, seed, names) => {
    it('lists Salary, Rent, Utilities, Refreshments, Conveyance and Miscellaneous', () => {
        expect(names).toEqual([
            'Salary',
            'Rent',
            'Utilities',
            'Refreshments',
            'Conveyance',
            'Miscellaneous',
        ]);
    });

    it('creates each missing category with a head of the same name', async () => {
        const tx = fakeTx(null);
        const result = await seed(tx, 'tenant-1');
        expect(result.created).toEqual([...names]);
        expect(tx.expenseHead.create).toHaveBeenCalledTimes(names.length);
        expect(tx.expenseHead.create).toHaveBeenCalledWith({
            data: { tenant_id: 'tenant-1', category_id: 'cat-Salary', name: 'Salary' },
        });
    });

    it('does not add a head when the category already has one', async () => {
        const tx = fakeTx({ id: 'cat-1', heads: 2 });
        const result = await seed(tx, 'tenant-1');
        expect(result.created).toEqual([]);
        expect(result.headsAdded).toEqual([]);
        expect(tx.expenseCategory.create).not.toHaveBeenCalled();
        expect(tx.expenseHead.create).not.toHaveBeenCalled();
    });

    it('adds only the head when the category exists with none', async () => {
        const tx = fakeTx({ id: 'cat-rent', heads: 0 });
        const result = await seed(tx, 'tenant-1');
        expect(result.created).toEqual([]);
        expect(result.headsAdded).toEqual([...names]);
        expect(tx.expenseCategory.create).not.toHaveBeenCalled();
        expect(tx.expenseHead.create).toHaveBeenCalledWith({
            data: { tenant_id: 'tenant-1', category_id: 'cat-rent', name: 'Salary' },
        });
    });

    it('writes nothing on a dry run', async () => {
        const tx = fakeTx(null);
        const result = await seed(tx, 'tenant-1', { dryRun: true });
        expect(result.created).toEqual([...names]);
        expect(tx.expenseCategory.create).not.toHaveBeenCalled();
        expect(tx.expenseHead.create).not.toHaveBeenCalled();
    });
});

export {};
