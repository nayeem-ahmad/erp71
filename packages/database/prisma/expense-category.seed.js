// CommonJS runtime counterpart of expense-category.seed.ts — keep the two in sync.
// This is the copy the backend actually loads: package.json `main` points at
// index.js, so a symbol missing here is `undefined` at runtime even though the
// TypeScript build is green.

const DEFAULT_EXPENSE_CATEGORIES = [
    'Salary',
    'Rent',
    'Utilities',
    'Refreshments',
    'Conveyance',
    'Miscellaneous',
];

async function seedDefaultExpenseCategories(tx, tenantId, options = {}) {
    const created = [];
    const headsAdded = [];
    const dryRun = options.dryRun ?? false;

    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        const existing = await tx.expenseCategory.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name } },
            include: { _count: { select: { heads: true } } },
        });

        if (!existing) {
            created.push(name);
            headsAdded.push(name);
            if (dryRun) continue;
            const category = await tx.expenseCategory.create({
                data: { tenant_id: tenantId, name },
            });
            await tx.expenseHead.create({
                data: { tenant_id: tenantId, category_id: category.id, name },
            });
            continue;
        }

        if ((existing._count?.heads ?? 0) === 0) {
            headsAdded.push(name);
            if (dryRun) continue;
            await tx.expenseHead.create({
                data: { tenant_id: tenantId, category_id: existing.id, name },
            });
        }
    }

    return { created, headsAdded };
}

module.exports = {
    DEFAULT_EXPENSE_CATEGORIES,
    seedDefaultExpenseCategories,
};
