/**
 * KH Tradind filed some expense categories as if they were heads. A person's
 * name becomes a head under Personal Expenses. The other names they asked to
 * fold in become heads under Other Expenses.
 *
 * Salary, Transport, Staff Conveyances, Shop Accessories and the bill
 * categories are left as categories. This script does not touch them.
 *
 * Runs after `db push` and after `sync:expense-heads`, which has already
 * given each old category a head of the same name. The head keeps its name
 * and its entries. Only the category on the entry changes, so the expense
 * report totals under Personal Expenses or Other Expenses and still splits
 * by the old name. Posted vouchers are not rewritten.
 *
 * Idempotent. A source category that is already gone is skipped. Creating
 * that same category name again later will fold it on the next prepare.
 * Any other tenant is ignored. A database without the expense tables is a
 * no-op.
 *
 * Usage:
 *   npx tsx prisma/sync-expense-reparent.ts --dry-run
 *   npx tsx prisma/sync-expense-reparent.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The workspace is stored as "KH Tradind". */
export const KH_TRADIND_TENANT_ID = '5e7c7f4a-3d21-4c6d-bf4b-f909e57b54f7';

export const PERSONAL_EXPENSES = 'Personal Expenses';
export const OTHER_EXPENSES = 'Other Expenses';

/** Category names that are a person. Each becomes a head under Personal Expenses. */
export const PERSONAL_EXPENSE_SOURCES = [
    'Md. Toriqul Islam',
    'Md. Israfil Shikder',
    'Md. Titu Shikder',
    'Sajid Bhatija',
    'Hazi Ansar Ali',
    'Adv. Pasha Vai Chuadanga',
    'Md. Abu Rayhan',
    'Md. Raju',
] as const;

/** The other names from the same cleanup. Each becomes a head under Other Expenses. */
export const OTHER_EXPENSE_SOURCES = [
    'Trust Care Company',
    'Vat Return',
    'Family Cost',
] as const;

const PLAN: { from: string; to: string }[] = [
    ...PERSONAL_EXPENSE_SOURCES.map((from) => ({ from, to: PERSONAL_EXPENSES })),
    ...OTHER_EXPENSE_SOURCES.map((from) => ({ from, to: OTHER_EXPENSES })),
];

export interface ReparentMove {
    from: string;
    to: string;
    entries: number;
    heads: number;
}

export interface ReparentResult {
    moves: ReparentMove[];
    parentsCreated: string[];
}

interface CategoryRow {
    id: string;
    name: string;
    account_id?: string | null;
}

interface HeadRow {
    id: string;
    name: string;
    category_id: string;
    account_id?: string | null;
}

/**
 * The slice of Prisma this script uses. A test can stand in for it. The
 * live script passes a transaction.
 */
export interface ReparentDb {
    expenseCategory: {
        findFirst(args: { where: { tenant_id: string; name: string } }): Promise<CategoryRow | null>;
        create(args: { data: { tenant_id: string; name: string } }): Promise<CategoryRow>;
        delete(args: { where: { id: string } }): Promise<unknown>;
    };
    expenseHead: {
        findMany(args: { where: { category_id: string } }): Promise<HeadRow[]>;
        findFirst(args: { where: { category_id: string; name: string } }): Promise<HeadRow | null>;
        create(args: { data: { tenant_id: string; category_id: string; name: string; account_id?: string | null } }): Promise<HeadRow>;
        update(args: { where: { id: string }; data: { category_id: string; account_id?: string | null } }): Promise<unknown>;
        delete(args: { where: { id: string } }): Promise<unknown>;
        count(args: { where: { category_id: string } }): Promise<number>;
    };
    expenseEntry: {
        count(args: { where: { category_id: string; head_id?: null } }): Promise<number>;
        updateMany(args: { where: Record<string, unknown>; data: { category_id?: string; head_id?: string } }): Promise<unknown>;
    };
    expenseClaimLine: {
        updateMany(args: { where: { category_id: string }; data: { category_id: string } }): Promise<unknown>;
    };
}

export async function reparentKhExpenseCategories(
    db: ReparentDb,
    options: { dryRun?: boolean; tenantId?: string } = {},
): Promise<ReparentResult> {
    const tenantId = options.tenantId ?? KH_TRADIND_TENANT_ID;
    const dryRun = options.dryRun ?? false;
    const moves: ReparentMove[] = [];
    const parentsCreated: string[] = [];
    const parents = new Map<string, CategoryRow>();

    for (const step of PLAN) {
        const source = await db.expenseCategory.findFirst({
            where: { tenant_id: tenantId, name: step.from },
        });
        if (!source) continue;

        let parent = parents.get(step.to);
        if (!parent) {
            const existing = await db.expenseCategory.findFirst({
                where: { tenant_id: tenantId, name: step.to },
            });
            if (existing) {
                parent = existing;
            } else if (dryRun) {
                parentsCreated.push(step.to);
                parent = { id: `dry-run:${step.to}`, name: step.to };
            } else {
                parent = await db.expenseCategory.create({
                    data: { tenant_id: tenantId, name: step.to },
                });
                parentsCreated.push(step.to);
            }
            parents.set(step.to, parent);
        }

        const heads = await db.expenseHead.findMany({ where: { category_id: source.id } });
        const unheaded = await db.expenseEntry.count({
            where: { category_id: source.id, head_id: null },
        });
        const entryCount = await db.expenseEntry.count({ where: { category_id: source.id } });
        const namedHead = heads.find((head) => head.name === source.name);
        const parentAlreadyHasName = namedHead
            ? false
            : Boolean(await db.expenseHead.findFirst({
                where: { category_id: parent.id, name: source.name },
            }));
        const createsHead = unheaded > 0 && !namedHead && !parentAlreadyHasName;

        moves.push({
            from: source.name,
            to: parent.name,
            entries: entryCount,
            heads: heads.length + (createsHead ? 1 : 0),
        });
        if (dryRun) continue;

        if (unheaded > 0) {
            let head = namedHead
                ?? await db.expenseHead.findFirst({ where: { category_id: parent.id, name: source.name } });
            if (!head) {
                head = await db.expenseHead.create({
                    data: {
                        tenant_id: tenantId,
                        category_id: parent.id,
                        name: source.name,
                        account_id: source.account_id ?? null,
                    },
                });
            }
            await db.expenseEntry.updateMany({
                where: { category_id: source.id, head_id: null },
                data: { head_id: head.id },
            });
        }

        for (const head of heads) {
            const clash = await db.expenseHead.findFirst({
                where: { category_id: parent.id, name: head.name },
            });
            if (clash && clash.id !== head.id) {
                await db.expenseEntry.updateMany({
                    where: { head_id: head.id },
                    data: { head_id: clash.id },
                });
                await db.expenseHead.delete({ where: { id: head.id } });
                continue;
            }
            await db.expenseHead.update({
                where: { id: head.id },
                data: {
                    category_id: parent.id,
                    ...(!head.account_id && source.account_id ? { account_id: source.account_id } : {}),
                },
            });
        }

        await db.expenseEntry.updateMany({
            where: { category_id: source.id },
            data: { category_id: parent.id },
        });
        await db.expenseClaimLine.updateMany({
            where: { category_id: source.id },
            data: { category_id: parent.id },
        });

        const headsLeft = await db.expenseHead.count({ where: { category_id: source.id } });
        const entriesLeft = await db.expenseEntry.count({ where: { category_id: source.id } });
        if (headsLeft === 0 && entriesLeft === 0) {
            await db.expenseCategory.delete({ where: { id: source.id } });
        }
    }

    return { moves, parentsCreated };
}

async function tableExists(name: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = ${name}
        ) AS "exists"
    `;
    return Boolean(rows[0]?.exists);
}

export async function syncKhExpenseReparent(
    client: PrismaClient = prisma,
    options: { dryRun?: boolean } = {},
): Promise<ReparentResult> {
    const empty: ReparentResult = { moves: [], parentsCreated: [] };
    if (!(await tableExists('ExpenseCategory')) || !(await tableExists('ExpenseHead')) || !(await tableExists('ExpenseEntry'))) {
        return empty;
    }
    const run = (db: ReparentDb) => reparentKhExpenseCategories(db, options);
    if (options.dryRun) return run(client);
    return client.$transaction((tx) => run(tx));
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`[sync-expense-reparent] KH Tradind (${dryRun ? 'DRY RUN' : 'LIVE'})`);
    const result = await syncKhExpenseReparent(prisma, { dryRun });
    if (result.moves.length === 0) {
        console.log('[sync-expense-reparent] Nothing to move.');
    } else {
        for (const move of result.moves) {
            console.log(
                `  ${move.from} → ${move.to}: ${move.entries} entry(s), ${move.heads} head(s)`,
            );
        }
        if (result.parentsCreated.length) {
            console.log(`  New categories: ${result.parentsCreated.join(', ')}`);
        }
    }
    if (dryRun) console.log('[sync-expense-reparent] --dry-run: no changes made.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[sync-expense-reparent] Failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
