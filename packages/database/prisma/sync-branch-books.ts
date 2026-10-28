/**
 * Folds each branch onto one cash drawer, then stamps employees and payroll.
 *
 * Dry-run unless `--yes`. Optional `--tenant=<uuid>`. One transaction per
 * tenant. A voucher that still has no branch, or a drawer that cannot be
 * retired, rolls that tenant back and the process exits 1.
 *
 * Production applies schema with `prisma db push`, which cannot create the
 * partial unique indexes or the cash-only check. This script installs those
 * before the data pass. That DDL commits even on a dry-run. If
 * `accounts.store_id` is missing, the script exits 1 and writes nothing:
 * apply the branch-drawers migration or `db push` first.
 *
 * Do not pass `--yes` against production until a dry-run has been reviewed.
 *
 *   npx tsx prisma/sync-branch-books.ts
 *   npx tsx prisma/sync-branch-books.ts --tenant=<uuid>
 *   npx tsx prisma/sync-branch-books.ts --yes
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env') });

import { Prisma, PrismaClient } from '@prisma/client';
import { nextAccountCode } from './account-code';
import {
    isCashDrawer,
    planBranchBooks,
    planCashMethods,
    planEmployeeBranch,
    planPayrollStore,
    type BranchRef,
    type DrawerAccount,
} from './sync-branch-books.utils';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--yes');
const TENANT_ARG = process.argv.find((arg) => arg.startsWith('--tenant='));
const TENANT_FILTER = TENANT_ARG ? TENANT_ARG.slice('--tenant='.length) : null;

class DryRunRollback extends Error {}

class StopTenant extends Error {
    constructor(readonly kind: 'aborted' | 'blocked' | 'fk') {
        super(kind);
    }
}

type StoreRow = { id: string; storeId: string | null };

const REQUIRED_COLUMNS: { table: string; column: string }[] = [
    { table: 'accounts', column: 'store_id' },
    { table: 'Employee', column: 'store_id' },
    { table: 'payroll_runs', column: 'store_id' },
];

function modeLabel(): string {
    return COMMIT ? 'apply' : 'dry-run';
}

function cashMethodName(branch: BranchRef & { code: string | null }, taken: Set<string>): string {
    const candidates = [
        'Cash',
        `Cash (${branch.name})`,
        branch.code ? `Cash (${branch.name} ${branch.code})` : `Cash (${branch.name} ${branch.id.slice(0, 8)})`,
    ];
    for (const candidate of candidates) {
        if (!taken.has(candidate)) return candidate;
    }
    return `Cash (${branch.name} ${branch.id})`;
}

function foreignKeyName(error: unknown): string | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
    if (error.code !== 'P2003' && error.code !== 'P2014') return null;
    const meta = error.meta ?? {};
    return String(meta.constraint ?? meta.field_name ?? meta.relation_name ?? error.code);
}

async function ensureBranchConstraints(): Promise<void> {
    const present = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND (
             (table_name = 'accounts' AND column_name = 'store_id')
             OR (table_name = 'Employee' AND column_name = 'store_id')
             OR (table_name = 'payroll_runs' AND column_name = 'store_id')
           )`,
    );
    const have = new Set(present.map((row) => row.table_name));
    const missing = REQUIRED_COLUMNS.filter((column) => !have.has(column.table)).map(
        (column) => `${column.table}.${column.column}`,
    );
    if (missing.length > 0) {
        console.error(
            `Missing ${missing.join(', ')}. Apply packages/database/prisma/migrations/20261028140000_branch_cash_drawers or run prisma db push before sync:branch-books.`,
        );
        process.exitCode = 1;
        return;
    }

    const statements = [
        `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_shared_name_key" ON "accounts" ("tenant_id", "name") WHERE "store_id" IS NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_one_drawer_per_branch" ON "accounts" ("tenant_id", "store_id") WHERE "store_id" IS NOT NULL`,
        `DO $$ BEGIN
            ALTER TABLE "accounts" ADD CONSTRAINT "accounts_store_id_cash_only"
            CHECK ("store_id" IS NULL OR "category" = 'cash');
         EXCEPTION WHEN duplicate_object THEN NULL;
         END $$`,
        `DROP INDEX IF EXISTS "accounts_tenant_id_name_key"`,
    ];
    for (const sql of statements) {
        try {
            await prisma.$executeRawUnsafe(sql);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Could not install branch-drawer constraints: ${message}`);
            process.exitCode = 1;
            return;
        }
    }
    console.log(`${modeLabel()}: branch-drawer constraints are in place (this DDL is kept on a dry-run).`);
}

async function lookupSourceStores(
    tx: Prisma.TransactionClient,
    key: string,
    ids: string[],
): Promise<StoreRow[]> {
    if (ids.length === 0) return [];
    const mapRows = (rows: { id: string; store_id: string | null }[]): StoreRow[] =>
        rows.map((row) => ({ id: row.id, storeId: row.store_id }));

    if (key === 'sales|sale' || key === 'external-sync|sale') {
        return mapRows(await tx.sale.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }));
    }
    if (key === 'sales|sale_return' || key === 'external-sync|sale_return') {
        return mapRows(await tx.salesReturn.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }));
    }
    if (key === 'purchases|purchase' || key === 'external-sync|purchase') {
        return mapRows(await tx.purchase.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }));
    }
    if (key === 'purchases|purchase_return' || key === 'external-sync|purchase_return') {
        return mapRows(
            await tx.purchaseReturn.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }),
        );
    }
    if (key === 'purchase-orders|purchase_order') {
        return mapRows(
            await tx.purchaseOrder.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }),
        );
    }
    if (key === 'expenses|expense_entry') {
        return mapRows(
            await tx.expenseEntry.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }),
        );
    }
    if (key === 'loans|loan') {
        return mapRows(await tx.loan.findMany({ where: { id: { in: ids } }, select: { id: true, store_id: true } }));
    }
    if (key === 'loans|loan_payment') {
        const payments = await tx.loanPayment.findMany({
            where: { id: { in: ids } },
            select: { id: true, loan: { select: { store_id: true } } },
        });
        return payments.map((payment) => ({ id: payment.id, storeId: payment.loan.store_id }));
    }
    if (
        key === 'customers|customer_payment' ||
        key === 'customers|customer_payout' ||
        key === 'customers|customer_payment_discount' ||
        key === 'external-sync|customer_payment'
    ) {
        return mapRows(
            await tx.customerCreditTransaction.findMany({
                where: { id: { in: ids } },
                select: { id: true, store_id: true },
            }),
        );
    }
    if (
        key === 'suppliers|supplier_payment' ||
        key === 'suppliers|supplier_payment_discount' ||
        key === 'external-sync|supplier_payment'
    ) {
        return mapRows(
            await tx.supplierCreditTransaction.findMany({
                where: { id: { in: ids } },
                select: { id: true, store_id: true },
            }),
        );
    }
    if (key === 'fund_transfers|fund_transfer_initiate') {
        const transfers = await tx.fundTransfer.findMany({
            where: { id: { in: ids } },
            select: { id: true, source_store_id: true },
        });
        return transfers.map((transfer) => ({ id: transfer.id, storeId: transfer.source_store_id }));
    }
    if (key === 'fund_transfers|fund_transfer_receive') {
        const transfers = await tx.fundTransfer.findMany({
            where: { id: { in: ids } },
            select: { id: true, destination_store_id: true },
        });
        return transfers.map((transfer) => ({ id: transfer.id, storeId: transfer.destination_store_id }));
    }
    if (key === 'warehouse_transfers|transfer') {
        const transfers = await tx.warehouseTransfer.findMany({
            where: { id: { in: ids } },
            select: { id: true, source_store_id: true, sourceWarehouse: { select: { store_id: true } } },
        });
        return transfers.map((transfer) => ({
            id: transfer.id,
            storeId: transfer.source_store_id ?? transfer.sourceWarehouse.store_id,
        }));
    }
    if (key === 'inventory|stock_take_adjustment') {
        const sessions = await tx.stockTakeSession.findMany({
            where: { id: { in: ids } },
            select: { id: true, warehouse: { select: { store_id: true } } },
        });
        return sessions.map((session) => ({ id: session.id, storeId: session.warehouse.store_id }));
    }
    if (key === 'inventory|shrinkage') {
        const rows = await tx.inventoryShrinkage.findMany({
            where: { id: { in: ids } },
            select: { id: true, warehouse: { select: { store_id: true } } },
        });
        return rows.map((row) => ({ id: row.id, storeId: row.warehouse.store_id }));
    }
    // salary_accrual and salary_payment have no store on the source row.
    // The employee home branch is assigned later in this same run, so it is
    // not a source for the voucher.
    return [];
}

async function resolveSourceStores(
    tx: Prisma.TransactionClient,
    vouchers: { id: string; source_module: string | null; source_type: string | null; source_id: string | null }[],
): Promise<Map<string, string | null>> {
    const buckets = new Map<string, { voucherId: string; sourceId: string }[]>();
    for (const voucher of vouchers) {
        if (!voucher.source_module || !voucher.source_type || !voucher.source_id) continue;
        const key = `${voucher.source_module}|${voucher.source_type}`;
        const list = buckets.get(key) ?? [];
        list.push({ voucherId: voucher.id, sourceId: voucher.source_id });
        buckets.set(key, list);
    }

    const resolved = new Map<string, string | null>();
    for (const [key, rows] of buckets) {
        const found = new Map(
            (await lookupSourceStores(tx, key, rows.map((row) => row.sourceId))).map((row) => [row.id, row.storeId]),
        );
        for (const row of rows) resolved.set(row.voucherId, found.get(row.sourceId) ?? null);
    }
    return resolved;
}

async function partyStoreByVoucher(
    tx: Prisma.TransactionClient,
    voucherIds: string[],
): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (voucherIds.length === 0) return result;

    const details = await tx.voucherDetail.findMany({
        where: {
            voucher_id: { in: voucherIds },
            party_id: { not: null },
            party_type: { in: ['CUSTOMER', 'SUPPLIER'] },
        },
        select: { voucher_id: true, party_type: true, party_id: true },
    });
    const customerIds = [...new Set(details.filter((row) => row.party_type === 'CUSTOMER' && row.party_id).map((row) => row.party_id!))];
    const supplierIds = [...new Set(details.filter((row) => row.party_type === 'SUPPLIER' && row.party_id).map((row) => row.party_id!))];
    const [customers, suppliers] = await Promise.all([
        customerIds.length
            ? tx.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, store_id: true } })
            : Promise.resolve([]),
        supplierIds.length
            ? tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, store_id: true } })
            : Promise.resolve([]),
    ]);
    const customerStore = new Map(customers.map((row) => [row.id, row.store_id]));
    const supplierStore = new Map(suppliers.map((row) => [row.id, row.store_id]));

    const storesByVoucher = new Map<string, Set<string>>();
    for (const detail of details) {
        if (!detail.party_id) continue;
        const storeId = detail.party_type === 'CUSTOMER'
            ? customerStore.get(detail.party_id)
            : detail.party_type === 'SUPPLIER'
              ? supplierStore.get(detail.party_id)
              : undefined;
        if (!storeId) continue;
        const set = storesByVoucher.get(detail.voucher_id) ?? new Set<string>();
        set.add(storeId);
        storesByVoucher.set(detail.voucher_id, set);
    }
    for (const voucherId of voucherIds) {
        const stores = storesByVoucher.get(voucherId);
        result.set(voucherId, stores?.size === 1 ? [...stores][0] : null);
    }
    return result;
}

function accountLabel(accounts: Map<string, { name: string; code: string | null }>, id: string, fallbackName?: string): string {
    const account = accounts.get(id);
    if (!account) return fallbackName ?? id;
    return account.code ? `${account.name} (${account.code})` : account.name;
}

async function foldTenant(
    tx: Prisma.TransactionClient,
    tenant: { id: string; name: string },
): Promise<void> {
    const tenantId = tenant.id;
    console.log(`\n${modeLabel()}: tenant ${tenant.name} (${tenantId})`);

    const stores = await tx.store.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, name: true, code: true, created_at: true },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    const branches: (BranchRef & { code: string | null })[] = stores.map((store) => ({
        id: store.id,
        name: store.name,
        code: store.code,
        createdAt: store.created_at.toISOString(),
    }));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));

    const accountRows = await tx.account.findMany({
        where: { tenant_id: tenantId },
        select: {
            id: true,
            name: true,
            code: true,
            category: true,
            type: true,
            store_id: true,
            created_at: true,
            group_id: true,
            subgroup_id: true,
            group: { select: { code: true } },
            subgroup: { select: { code: true } },
        },
    });
    const accounts: (DrawerAccount & {
        type: string;
        groupId: string;
        subgroupId: string | null;
        groupCode: string;
        subgroupCode: string | null;
    })[] = accountRows.map((account) => ({
        id: account.id,
        name: account.name,
        code: account.code,
        category: account.category,
        type: account.type,
        storeId: account.store_id,
        createdAt: account.created_at.toISOString(),
        groupId: account.group_id,
        subgroupId: account.subgroup_id,
        groupCode: account.group.code,
        subgroupCode: account.subgroup?.code || null,
    }));
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    const walletMethods = await tx.paymentMethod.findMany({
        where: { tenant_id: tenantId, type: { equals: 'Mobile Wallet', mode: 'insensitive' } },
        select: { account_id: true },
    });
    const walletAccountIds = [...new Set(walletMethods.map((method) => method.account_id).filter((id): id is string => !!id))];
    const walletSet = new Set(walletAccountIds);
    const drawerIds = accounts.filter((account) => isCashDrawer(account, walletSet)).map((account) => account.id);

    const detailRows = drawerIds.length
        ? await tx.voucherDetail.findMany({
            where: { account_id: { in: drawerIds }, voucher: { tenant_id: tenantId } },
            select: {
                id: true,
                account_id: true,
                debit_amount: true,
                credit_amount: true,
                voucher: {
                    select: {
                        id: true,
                        voucher_number: true,
                        date: true,
                        store_id: true,
                        source_module: true,
                        source_type: true,
                        source_id: true,
                    },
                },
            },
        })
        : [];

    const unresolved = detailRows
        .filter((row) => !row.voucher.store_id)
        .map((row) => row.voucher);
    const uniqueUnresolved = [...new Map(unresolved.map((voucher) => [voucher.id, voucher])).values()];
    const [sourceStores, partyStores] = await Promise.all([
        resolveSourceStores(tx, uniqueUnresolved),
        partyStoreByVoucher(tx, uniqueUnresolved.map((voucher) => voucher.id)),
    ]);

    const [debitRules, creditRules, pointingMethods] = drawerIds.length
        ? await Promise.all([
            tx.postingRule.findMany({
                where: { tenant_id: tenantId, debit_account_id: { in: drawerIds } },
                select: { debit_account_id: true },
            }),
            tx.postingRule.findMany({
                where: { tenant_id: tenantId, credit_account_id: { in: drawerIds } },
                select: { credit_account_id: true },
            }),
            tx.paymentMethod.findMany({
                where: { tenant_id: tenantId, account_id: { in: drawerIds } },
                select: { account_id: true },
            }),
        ])
        : [[], [], []];
    const pointed = new Set<string>();
    for (const rule of debitRules) pointed.add(rule.debit_account_id);
    for (const rule of creditRules) pointed.add(rule.credit_account_id);
    for (const method of pointingMethods) if (method.account_id) pointed.add(method.account_id);

    const plan = planBranchBooks({
        branches,
        accounts,
        walletAccountIds,
        lines: detailRows.map((row) => ({
            detailId: row.id,
            voucherId: row.voucher.id,
            voucherNumber: row.voucher.voucher_number,
            voucherDate: row.voucher.date.toISOString(),
            accountId: row.account_id,
            storeId: row.voucher.store_id,
            sourceStoreId: row.voucher.store_id ? null : sourceStores.get(row.voucher.id) ?? null,
            partyStoreId: row.voucher.store_id ? null : partyStores.get(row.voucher.id) ?? null,
            debit: Number(row.debit_amount),
            credit: Number(row.credit_amount),
        })),
        rulesAndMethodsPointingAt: [...pointed].map((accountId) => ({ accountId })),
    });

    if (plan.aborted) {
        console.error(`  aborted: ${plan.unplaced.length} drawer voucher(s) have no branch. Nothing written.`);
        for (const row of plan.unplaced) {
            console.error(
                `  unplaced ${row.voucherNumber} ${row.voucherDate} ${row.accountName} debit ${row.debit} credit ${row.credit}`,
            );
        }
        throw new StopTenant('aborted');
    }
    if (plan.blockedRetire.length > 0) {
        for (const row of plan.blockedRetire) {
            console.error(`  blocked retire ${accountLabel(accountsById, row.accountId)}: ${row.reason}. Nothing written.`);
        }
        throw new StopTenant('blocked');
    }

    const codes = accounts.map((account) => account.code).filter((code): code is string => !!code);
    const newIdByToken = new Map<string, string>();
    const createdDrawers: { accountId: string; storeId: string; name: string; code: string; clone: (typeof accounts)[number] }[] = [];
    for (const drawer of plan.newDrawers) {
        const clone = accountsById.get(drawer.cloneFromAccountId);
        if (!clone) {
            console.error(`  cannot create a drawer for ${drawer.storeId}: source account ${drawer.cloneFromAccountId} is missing. Nothing written.`);
            throw new StopTenant('aborted');
        }
        const code = nextAccountCode(clone.groupCode, clone.subgroupCode, codes);
        codes.push(code);
        const accountId = randomUUID();
        newIdByToken.set(`new:${drawer.storeId}`, accountId);
        createdDrawers.push({ accountId, storeId: drawer.storeId, name: drawer.name, code, clone });
    }
    const resolveId = (accountId: string): string => {
        if (!accountId.startsWith('new:')) return accountId;
        const real = newIdByToken.get(accountId);
        if (!real) throw new StopTenant('aborted');
        return real;
    };

    const lineMoves = plan.lineMoves.map((move) => ({ ...move, toAccountId: resolveId(move.toAccountId) }));
    const retargets = plan.retargets.map((row) => ({ ...row, toAccountId: resolveId(row.toAccountId) }));

    const voucherBranches = new Map<string, string>();
    for (const row of plan.voucherBranches) {
        const existing = voucherBranches.get(row.voucherId);
        if (existing && existing !== row.storeId) {
            console.error(`  voucher ${row.voucherId} resolved to two branches. Nothing written.`);
            throw new StopTenant('aborted');
        }
        voucherBranches.set(row.voucherId, row.storeId);
    }

    for (const [voucherId, storeId] of voucherBranches) {
        await tx.voucher.updateMany({
            where: { id: voucherId, tenant_id: tenantId, store_id: null },
            data: { store_id: storeId, attribution: 'BRANCH' },
        });
    }

    if (plan.retireAccountIds.length > 0) {
        await tx.account.updateMany({
            where: { id: { in: plan.retireAccountIds }, tenant_id: tenantId },
            data: { store_id: null },
        });
    }
    for (const row of plan.drawerAssignments) {
        await tx.account.update({
            where: { id: row.accountId },
            data: { store_id: row.storeId },
        });
    }
    for (const drawer of createdDrawers) {
        await tx.account.create({
            data: {
                id: drawer.accountId,
                tenant_id: tenantId,
                group_id: drawer.clone.groupId,
                subgroup_id: drawer.clone.subgroupId,
                name: drawer.name,
                code: drawer.code,
                type: drawer.clone.type,
                category: 'cash',
                store_id: drawer.storeId,
            },
        });
        accountsById.set(drawer.accountId, {
            ...drawer.clone,
            id: drawer.accountId,
            name: drawer.name,
            code: drawer.code,
            storeId: drawer.storeId,
            category: 'cash',
        });
    }

    for (const move of lineMoves) {
        await tx.voucherDetail.update({
            where: { id: move.detailId },
            data: { account_id: move.toAccountId },
        });
    }
    for (const retarget of retargets) {
        await tx.postingRule.updateMany({
            where: { tenant_id: tenantId, debit_account_id: retarget.fromAccountId },
            data: { debit_account_id: retarget.toAccountId },
        });
        await tx.postingRule.updateMany({
            where: { tenant_id: tenantId, credit_account_id: retarget.fromAccountId },
            data: { credit_account_id: retarget.toAccountId },
        });
        await tx.paymentMethod.updateMany({
            where: { tenant_id: tenantId, account_id: retarget.fromAccountId },
            data: { account_id: retarget.toAccountId },
        });
    }
    for (const accountId of plan.retireAccountIds) {
        const remaining = await tx.voucherDetail.count({ where: { account_id: accountId } });
        if (remaining > 0) {
            console.error(`  refusing to retire ${accountLabel(accountsById, accountId)}: ${remaining} voucher line(s) remain. Nothing written.`);
            throw new StopTenant('blocked');
        }
        try {
            await tx.account.delete({ where: { id: accountId } });
        } catch (error) {
            const constraint = foreignKeyName(error);
            console.error(
                `  cannot retire ${accountLabel(accountsById, accountId)}: ${constraint ?? (error instanceof Error ? error.message : 'delete failed')}. Nothing written.`,
            );
            throw new StopTenant('fk');
        }
    }

    const drawers: { accountId: string; storeId: string }[] = [];
    const seenStores = new Set<string>();
    for (const row of plan.drawerAssignments) {
        drawers.push(row);
        seenStores.add(row.storeId);
    }
    for (const drawer of createdDrawers) {
        if (seenStores.has(drawer.storeId)) continue;
        drawers.push({ accountId: drawer.accountId, storeId: drawer.storeId });
        seenStores.add(drawer.storeId);
    }
    for (const account of accounts) {
        if (!account.storeId || !isCashDrawer(account, walletSet) || seenStores.has(account.storeId)) continue;
        if (plan.retireAccountIds.includes(account.id)) continue;
        drawers.push({ accountId: account.id, storeId: account.storeId });
        seenStores.add(account.storeId);
    }

    const methods = await tx.paymentMethod.findMany({
        where: { tenant_id: tenantId },
        select: {
            id: true,
            name: true,
            type: true,
            account_id: true,
            all_branches: true,
            is_active: true,
            show_on_entry: true,
            sort_order: true,
            stores: { select: { store_id: true } },
        },
    });
    const cashPlan = planCashMethods({
        methods: methods.map((method) => ({
            id: method.id,
            name: method.name,
            type: method.type,
            accountId: method.account_id,
            allBranches: method.all_branches,
            storeIds: method.stores.map((store) => store.store_id),
        })),
        drawers,
    });
    const methodById = new Map(methods.map((method) => [method.id, method]));
    const takenNames = new Set(methods.map((method) => method.name));

    for (const update of cashPlan.updates) {
        await tx.paymentMethod.update({
            where: { id: update.methodId },
            data: { account_id: update.accountId, all_branches: false },
        });
        await tx.paymentMethodStore.deleteMany({ where: { payment_method_id: update.methodId } });
        await tx.paymentMethodStore.create({
            data: { tenant_id: tenantId, payment_method_id: update.methodId, store_id: update.storeId },
        });
    }
    for (const create of cashPlan.creates) {
        const branch = branchById.get(create.storeId);
        const name = cashMethodName(
            branch ?? { id: create.storeId, name: create.storeId, code: null, createdAt: '' },
            takenNames,
        );
        takenNames.add(name);
        const source = methodById.get(create.copyFromMethodId);
        await tx.paymentMethod.create({
            data: {
                tenant_id: tenantId,
                type: 'Cash',
                name,
                account_id: create.accountId,
                is_active: source?.is_active ?? true,
                show_on_entry: source?.show_on_entry ?? true,
                sort_order: source?.sort_order ?? 0,
                all_branches: false,
                stores: { create: { tenant_id: tenantId, store_id: create.storeId } },
            },
        });
        console.log(`  cash method create "${name}" → ${branch?.name ?? create.storeId}`);
    }

    const employees = await tx.employee.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, employee_code: true, name: true, user_id: true, store_id: true },
    });
    const userIds = employees.map((employee) => employee.user_id).filter((id): id is string => !!id);
    const [accessRows, punchRows] = await Promise.all([
        userIds.length
            ? tx.userStoreAccess.findMany({
                where: { tenant_id: tenantId, user_id: { in: userIds } },
                select: { user_id: true, store_id: true },
            })
            : Promise.resolve([]),
        tx.attendancePunch.groupBy({
            by: ['employee_id', 'store_id'],
            where: { tenant_id: tenantId, store_id: { not: null } },
            _count: { _all: true },
        }),
    ]);
    const accessByUser = new Map<string, string[]>();
    for (const row of accessRows) {
        const list = accessByUser.get(row.user_id) ?? [];
        list.push(row.store_id);
        accessByUser.set(row.user_id, list);
    }
    const punchesByEmployee = new Map<string, { storeId: string; count: number }[]>();
    for (const row of punchRows) {
        if (!row.store_id) continue;
        const list = punchesByEmployee.get(row.employee_id) ?? [];
        list.push({ storeId: row.store_id, count: row._count._all });
        punchesByEmployee.set(row.employee_id, list);
    }

    const employeeStore = new Map<string, string | null>(employees.map((employee) => [employee.id, employee.store_id]));
    let fallbacks = 0;
    for (const employee of employees) {
        if (employee.store_id) continue;
        const decision = planEmployeeBranch({
            branches,
            userStoreIds: employee.user_id ? accessByUser.get(employee.user_id) ?? [] : [],
            punchCounts: punchesByEmployee.get(employee.id) ?? [],
        });
        if (!decision.storeId) {
            console.log(`  ${employee.employee_code} ${employee.name} → (no branch)`);
            continue;
        }
        if (decision.fallbackToMain) {
            fallbacks += 1;
            const branchName = branchById.get(decision.storeId)?.name ?? decision.storeId;
            console.log(`  ${employee.employee_code} ${employee.name} → ${branchName}`);
        }
        employeeStore.set(employee.id, decision.storeId);
        await tx.employee.update({ where: { id: employee.id }, data: { store_id: decision.storeId } });
    }
    if (fallbacks === 0) console.log('  employee fallbacks: none');

    const runs = await tx.payrollRun.findMany({
        where: { tenant_id: tenantId },
        select: {
            id: true,
            year: true,
            month: true,
            kind: true,
            store_id: true,
            lines: { select: { employee_id: true } },
        },
    });
    const claimed = new Set(runs.filter((run) => run.store_id).map((run) => `${run.year}|${run.month}|${run.kind}|${run.store_id}`));
    for (const run of runs) {
        if (run.store_id) continue;
        const storeId = planPayrollStore(run.lines.map((line) => employeeStore.get(line.employee_id) ?? null));
        if (!storeId) continue;
        const key = `${run.year}|${run.month}|${run.kind}|${storeId}`;
        if (claimed.has(key)) {
            console.log(`  payroll ${run.year}-${run.month} ${run.kind} left unset: that branch already has this run`);
            continue;
        }
        claimed.add(key);
        await tx.payrollRun.update({ where: { id: run.id }, data: { store_id: storeId } });
    }

    console.log('  shared bank and wallet accounts are unchanged');
    if (plan.drawerAssignments.length === 0 && createdDrawers.length === 0) {
        console.log('  drawers: none');
    }
    for (const row of plan.drawerAssignments) {
        console.log(`  drawer ${accountLabel(accountsById, row.accountId)} → ${branchById.get(row.storeId)?.name ?? row.storeId}`);
    }
    for (const drawer of createdDrawers) {
        console.log(`  new drawer ${drawer.name} (${drawer.code}) → ${branchById.get(drawer.storeId)?.name ?? drawer.storeId}`);
    }
    const moveCounts = new Map<string, number>();
    for (const move of lineMoves) {
        const label = `${accountLabel(accountsById, move.fromAccountId)} → ${accountLabel(accountsById, move.toAccountId)}`;
        moveCounts.set(label, (moveCounts.get(label) ?? 0) + 1);
    }
    if (moveCounts.size === 0) console.log('  line moves: none');
    for (const [label, count] of moveCounts) console.log(`  line moves ${count}: ${label}`);
    if (plan.retireAccountIds.length === 0) console.log('  retire: none');
    for (const accountId of plan.retireAccountIds) console.log(`  retire ${accountLabel(accountsById, accountId)}`);
    if (cashPlan.updates.length === 0 && cashPlan.creates.length === 0) console.log('  cash methods: none');
    for (const update of cashPlan.updates) {
        const method = methodById.get(update.methodId);
        console.log(
            `  cash method update ${method?.name ?? update.methodId} → ${branchById.get(update.storeId)?.name ?? update.storeId} / ${accountLabel(accountsById, update.accountId)}`,
        );
    }

    if (!COMMIT) throw new DryRunRollback();
}

async function lockEmployeeBranch(): Promise<void> {
    if (!COMMIT || TENANT_FILTER) return;
    const remaining = await prisma.employee.count({ where: { store_id: null } });
    if (remaining > 0) {
        console.log(`Employee.store_id stays nullable: ${remaining} row(s) still have no branch.`);
        return;
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE "Employee" ALTER COLUMN store_id SET NOT NULL`);
    console.log('Employee.store_id is now NOT NULL.');
}

async function main(): Promise<number> {
    await ensureBranchConstraints();
    if (process.exitCode) return 1;

    const tenants = await prisma.tenant.findMany({
        where: TENANT_FILTER ? { id: TENANT_FILTER } : {},
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    if (TENANT_FILTER && tenants.length === 0) {
        console.log(`${modeLabel()}: tenant ${TENANT_FILTER} was not found. Nothing to do.`);
        return 0;
    }
    if (tenants.length === 0) {
        console.log(`${modeLabel()}: no tenants. Nothing to do.`);
        return 0;
    }

    let failed = 0;
    for (const tenant of tenants) {
        try {
            await prisma.$transaction((tx) => foldTenant(tx, tenant), { timeout: 300_000, maxWait: 20_000 });
            console.log(`apply: tenant ${tenant.name} committed.`);
        } catch (error) {
            if (error instanceof DryRunRollback) {
                console.log(`dry-run: tenant ${tenant.name} rolled back. No rows written.`);
                continue;
            }
            if (error instanceof StopTenant) {
                failed += 1;
                console.error(`${modeLabel()}: tenant ${tenant.name} rolled back (${error.kind}).`);
                continue;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                failed += 1;
                const detail = error.message.split('\n').map((line) => line.trim()).filter(Boolean).pop();
                console.error(`${modeLabel()}: tenant ${tenant.name} rolled back: ${error.code} ${detail ?? ''}`.trim());
                continue;
            }
            throw error;
        }
    }

    if (failed > 0) {
        console.error(`${modeLabel()}: ${failed} tenant(s) failed. No employee NOT NULL change.`);
        return 1;
    }
    await lockEmployeeBranch();
    if (COMMIT) console.log(`apply finished: ${tenants.length} tenant(s).`);
    else console.log(`dry-run finished: ${tenants.length} tenant(s). No rows written.`);
    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
