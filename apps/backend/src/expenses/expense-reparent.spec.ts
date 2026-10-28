/**
 * The script the prepare step runs. The TypeScript source is what is edited
 * and what `tsx` executes.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const reparent = require('../../../../packages/database/prisma/sync-expense-reparent.ts');

const {
    KH_TRADIND_TENANT_ID,
    PERSONAL_EXPENSES,
    OTHER_EXPENSES,
    reparentKhExpenseCategories,
} = reparent;

interface Category {
    id: string;
    tenant_id: string;
    name: string;
    account_id?: string | null;
}

interface Head {
    id: string;
    tenant_id: string;
    category_id: string;
    name: string;
    account_id?: string | null;
}

interface Entry {
    id: string;
    category_id: string;
    head_id: string | null;
}

interface Claim {
    id: string;
    category_id: string;
}

function memoryDb(seed: { categories: Category[]; heads: Head[]; entries: Entry[]; claims?: Claim[] }) {
    const categories = seed.categories;
    const heads = seed.heads;
    const entries = seed.entries;
    const claims = seed.claims ?? [];
    let seq = 1;
    const whereEntry = (where: { category_id?: string; head_id?: string | null }) => entries.filter((entry) => {
        if (where.category_id !== undefined && entry.category_id !== where.category_id) return false;
        if ('head_id' in where && entry.head_id !== where.head_id) return false;
        return true;
    });

    return {
        categories,
        heads,
        entries,
        claims,
        db: {
            expenseCategory: {
                findFirst: jest.fn(async ({ where }: { where: { tenant_id: string; name: string } }) =>
                    categories.find((row) => row.tenant_id === where.tenant_id && row.name === where.name) ?? null),
                create: jest.fn(async ({ data }: { data: { tenant_id: string; name: string } }) => {
                    const row: Category = { id: `new-${seq++}`, account_id: null, ...data };
                    categories.push(row);
                    return row;
                }),
                delete: jest.fn(async ({ where }: { where: { id: string } }) => {
                    const index = categories.findIndex((row) => row.id === where.id);
                    if (index >= 0) categories.splice(index, 1);
                }),
            },
            expenseHead: {
                findMany: jest.fn(async ({ where }: { where: { category_id: string } }) =>
                    heads.filter((row) => row.category_id === where.category_id)),
                findFirst: jest.fn(async ({ where }: { where: { category_id: string; name: string } }) =>
                    heads.find((row) => row.category_id === where.category_id && row.name === where.name) ?? null),
                create: jest.fn(async ({ data }: { data: Head }) => {
                    const row = { id: `head-${seq++}`, account_id: null, ...data };
                    heads.push(row);
                    return row;
                }),
                update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Head> }) => {
                    const row = heads.find((item) => item.id === where.id);
                    if (row) Object.assign(row, data);
                }),
                delete: jest.fn(async ({ where }: { where: { id: string } }) => {
                    const index = heads.findIndex((row) => row.id === where.id);
                    if (index >= 0) heads.splice(index, 1);
                }),
                count: jest.fn(async ({ where }: { where: { category_id: string } }) =>
                    heads.filter((row) => row.category_id === where.category_id).length),
            },
            expenseEntry: {
                count: jest.fn(async ({ where }: { where: { category_id: string; head_id?: null } }) =>
                    whereEntry(where).length),
                updateMany: jest.fn(async ({ where, data }: { where: { category_id?: string; head_id?: string | null }; data: Partial<Entry> }) => {
                    for (const entry of whereEntry(where)) Object.assign(entry, data);
                }),
            },
            expenseClaimLine: {
                updateMany: jest.fn(async ({ where, data }: { where: { category_id: string }; data: { category_id: string } }) => {
                    for (const claim of claims) {
                        if (claim.category_id === where.category_id) claim.category_id = data.category_id;
                    }
                }),
            },
        },
    };
}

describe('reparentKhExpenseCategories', () => {
    it('moves a person under Personal Expenses and leaves Salary where it is', async () => {
        const store = memoryDb({
            categories: [
                { id: 'cat-raju', tenant_id: KH_TRADIND_TENANT_ID, name: 'Md. Raju' },
                { id: 'cat-salary', tenant_id: KH_TRADIND_TENANT_ID, name: 'Salary', account_id: 'acct-salary' },
            ],
            heads: [
                { id: 'head-raju', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-raju', name: 'Md. Raju' },
                { id: 'head-salary', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-salary', name: 'Salary' },
            ],
            entries: [
                { id: 'e1', category_id: 'cat-raju', head_id: 'head-raju' },
                { id: 'e2', category_id: 'cat-salary', head_id: 'head-salary' },
            ],
            claims: [{ id: 'claim-1', category_id: 'cat-raju' }],
        });

        const result = await reparentKhExpenseCategories(store.db);

        expect(result.parentsCreated).toEqual([PERSONAL_EXPENSES]);
        expect(result.moves).toEqual([
            { from: 'Md. Raju', to: PERSONAL_EXPENSES, entries: 1, heads: 1 },
        ]);
        const personal = store.categories.find((row) => row.name === PERSONAL_EXPENSES);
        expect(personal).toBeTruthy();
        expect(store.categories.find((row) => row.name === 'Md. Raju')).toBeUndefined();
        expect(store.heads.find((row) => row.id === 'head-raju')).toMatchObject({
            name: 'Md. Raju',
            category_id: personal!.id,
        });
        expect(store.entries.find((row) => row.id === 'e1')).toMatchObject({
            category_id: personal!.id,
            head_id: 'head-raju',
        });
        expect(store.claims[0].category_id).toBe(personal!.id);
        expect(store.entries.find((row) => row.id === 'e2')!.category_id).toBe('cat-salary');
        expect(store.categories.find((row) => row.name === 'Salary')!.account_id).toBe('acct-salary');
    });

    it('puts Trust Care Company under Other Expenses and keeps one parent for every person', async () => {
        const store = memoryDb({
            categories: [
                { id: 'cat-toriqul', tenant_id: KH_TRADIND_TENANT_ID, name: 'Md. Toriqul Islam' },
                { id: 'cat-trust', tenant_id: KH_TRADIND_TENANT_ID, name: 'Trust Care Company', account_id: 'acct-trust' },
            ],
            heads: [
                { id: 'head-toriqul', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-toriqul', name: 'Md. Toriqul Islam' },
                { id: 'head-trust', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-trust', name: 'Trust Care Company' },
            ],
            entries: [
                { id: 'e1', category_id: 'cat-toriqul', head_id: 'head-toriqul' },
                { id: 'e2', category_id: 'cat-trust', head_id: 'head-trust' },
            ],
        });

        const result = await reparentKhExpenseCategories(store.db);

        expect(result.parentsCreated).toEqual([PERSONAL_EXPENSES, OTHER_EXPENSES]);
        expect(result.moves.map((move) => move.to)).toEqual([PERSONAL_EXPENSES, OTHER_EXPENSES]);
        const other = store.categories.find((row) => row.name === OTHER_EXPENSES)!;
        expect(store.heads.find((row) => row.id === 'head-trust')).toMatchObject({
            category_id: other.id,
            account_id: 'acct-trust',
        });
        expect(store.categories.find((row) => row.name === 'Trust Care Company')).toBeUndefined();
    });

    it('joins a head the parent already has, and gives an unheaded entry a head', async () => {
        const store = memoryDb({
            categories: [
                { id: 'cat-personal', tenant_id: KH_TRADIND_TENANT_ID, name: PERSONAL_EXPENSES },
                { id: 'cat-raju', tenant_id: KH_TRADIND_TENANT_ID, name: 'Md. Raju' },
                { id: 'cat-family', tenant_id: KH_TRADIND_TENANT_ID, name: 'Family Cost' },
            ],
            heads: [
                { id: 'head-existing', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-personal', name: 'Md. Raju' },
                { id: 'head-old', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-raju', name: 'Md. Raju' },
            ],
            entries: [
                { id: 'e-old', category_id: 'cat-raju', head_id: 'head-old' },
                { id: 'e-new', category_id: 'cat-family', head_id: null },
            ],
        });

        await reparentKhExpenseCategories(store.db);

        expect(store.heads.find((row) => row.id === 'head-old')).toBeUndefined();
        expect(store.entries.find((row) => row.id === 'e-old')).toMatchObject({
            category_id: 'cat-personal',
            head_id: 'head-existing',
        });
        const familyHead = store.heads.find((row) => row.name === 'Family Cost');
        expect(familyHead!.category_id).toBe(store.categories.find((row) => row.name === OTHER_EXPENSES)!.id);
        expect(store.entries.find((row) => row.id === 'e-new')!.head_id).toBe(familyHead!.id);
        expect(store.categories.find((row) => row.name === 'Family Cost')).toBeUndefined();
    });

    it('writes nothing on a dry run', async () => {
        const store = memoryDb({
            categories: [{ id: 'cat-raju', tenant_id: KH_TRADIND_TENANT_ID, name: 'Md. Raju' }],
            heads: [{ id: 'head-raju', tenant_id: KH_TRADIND_TENANT_ID, category_id: 'cat-raju', name: 'Md. Raju' }],
            entries: [{ id: 'e1', category_id: 'cat-raju', head_id: 'head-raju' }],
        });

        const result = await reparentKhExpenseCategories(store.db, { dryRun: true });

        expect(result.moves).toEqual([
            { from: 'Md. Raju', to: PERSONAL_EXPENSES, entries: 1, heads: 1 },
        ]);
        expect(result.parentsCreated).toEqual([PERSONAL_EXPENSES]);
        expect(store.db.expenseCategory.create).not.toHaveBeenCalled();
        expect(store.db.expenseHead.update).not.toHaveBeenCalled();
        expect(store.db.expenseEntry.updateMany).not.toHaveBeenCalled();
        expect(store.categories.map((row) => row.name)).toEqual(['Md. Raju']);
    });

    it('does nothing when those categories are already gone', async () => {
        const store = memoryDb({
            categories: [{ id: 'cat-salary', tenant_id: KH_TRADIND_TENANT_ID, name: 'Salary' }],
            heads: [],
            entries: [],
        });

        const result = await reparentKhExpenseCategories(store.db);

        expect(result).toEqual({ moves: [], parentsCreated: [] });
        expect(store.db.expenseCategory.create).not.toHaveBeenCalled();
    });
});

export {};
