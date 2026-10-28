/**
 * Default expense categories for a new shop, each with a head of the same
 * name so an expense can be recorded immediately.
 *
 * Idempotent. A category the tenant already has (same name) is left alone,
 * including its account. A category with no heads gets the same-named head,
 * because the entry form cannot save without one. A category the tenant
 * deleted is created again the next time this runs — same as the CRM lookup
 * lists — so a deploy puts the defaults back.
 *
 * Account stays unset. Posting then uses the expense rule's debit, which is
 * General Operating Expense, until someone connects the category to another
 * expense account.
 */

export const DEFAULT_EXPENSE_CATEGORIES = [
    'Salary',
    'Rent',
    'Utilities',
    'Refreshments',
    'Conveyance',
    'Miscellaneous',
] as const;

export interface SeedExpenseCategoriesResult {
    /** Category names inserted on this call. */
    created: string[];
    /** Category names that gained a head of the same name. */
    headsAdded: string[];
}

export async function seedDefaultExpenseCategories(
    tx: any,
    tenantId: string,
    options: { dryRun?: boolean } = {},
): Promise<SeedExpenseCategoriesResult> {
    const created: string[] = [];
    const headsAdded: string[] = [];
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
