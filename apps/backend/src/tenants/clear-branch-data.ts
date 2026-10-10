import { Prisma } from '@prisma/client';
import { customerLedgerDueDelta } from '../customers/customer-credit.utils';
import { purchasePaymentStatus } from '../purchases/purchase-status';

type Tx = Prisma.TransactionClient;

/**
 * Postgres caps one statement at 65,535 bind parameters, and a busy branch's
 * documents run well past that once they are spelled out as an `IN (...)`
 * list. Every id-list filter below goes through this instead.
 */
const CHUNK = 5_000;

async function chunked(ids: string[], run: (chunk: string[]) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < ids.length; i += CHUNK) {
        await run(ids.slice(i, i + CHUNK));
    }
}

async function findChunked<T>(ids: string[], find: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = [];
    await chunked(ids, async (chunk) => {
        rows.push(...(await find(chunk)));
    });
    return rows;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Same rule as the supplier service's `ledgerDueDelta`. */
function supplierLedgerDueDelta(type: string, amount: number, discount = 0): number {
    switch (type) {
        case 'CREDIT_PURCHASE':
        case 'PAYOUT':
        case 'ADJUSTMENT':
            return amount;
        case 'PAYMENT':
            return -(amount + discount);
        default:
            return 0;
    }
}

function sumBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => number): Map<string, number> {
    const totals = new Map<string, number>();
    for (const row of rows) {
        totals.set(key(row), (totals.get(key(row)) ?? 0) + value(row));
    }
    return totals;
}

/**
 * Clear Data's "transactions" mode for one branch. Master data — products,
 * customers, suppliers, employees, the chart of accounts — is shared by every
 * branch, so a branch only ever loses its own documents and the journal
 * entries they posted.
 *
 * What goes: every sale, return, quotation, order, purchase, RFQ, demand,
 * stock movement, shrinkage, stock take, warehouse transfer, fund transfer,
 * expense, loan, investor profit run, cashier session, attendance record and
 * CRM lead/activity/follow-up/interaction recorded at the branch, the vouchers
 * those documents posted, and the branch's manual vouchers.
 *
 * Two kinds of record cross branches and go whole, both legs, because half of
 * one leaves the other branch's books unbalanced: a fund transfer or warehouse
 * transfer with this branch on either end.
 *
 * Customer and supplier ledger rows go two ways. One a deleted sale, purchase
 * or return wrote goes with it. One no document stands behind — a payment or
 * payout taken on the payments screens, a write-off, an opening balance — goes
 * when it was recorded at the branch (`store_id`, the party's branch when it
 * was written). A row tied to a document that survives at another branch
 * stays with that document. Either way the party's running due moves back by
 * what the deleted rows had moved it, so a customer is not left owing for a
 * sale that no longer exists, nor in credit for a payment against one. A
 * deleted supplier payment that had paid a bill at another branch hands that
 * bill its paid amount back. Loyalty points earned or redeemed on a deleted
 * sale come off the same way.
 *
 * What stays: shop-wide records with no branch of their own — payroll,
 * depreciation, investor capital, import shipments (and the LC payments
 * against them), storefront orders — and their vouchers. Stock levels stay as
 * they are, exactly as the shop-wide clear leaves them.
 */
export async function clearBranchTransactions(tx: Tx, tenantId: string, storeId: string): Promise<void> {
    const inBranch = { tenant_id: tenantId, store_id: storeId };

    // --- What belongs to the branch ---

    const warehouseIds = ids(await tx.warehouse.findMany({ where: inBranch, select: { id: true } }));
    const inBranchWarehouse = { tenant_id: tenantId, warehouse_id: { in: warehouseIds } };

    const saleIds = ids(await tx.sale.findMany({ where: inBranch, select: { id: true } }));
    // A return or claim is filed at the branch that sold the item, but one
    // pointing at this branch's sale goes with the sale wherever it was filed:
    // the sale it refers to is about to disappear.
    const fromBranchSale = { tenant_id: tenantId, OR: [{ store_id: storeId }, { sale: { store_id: storeId } }] };
    const salesReturnIds = ids(await tx.salesReturn.findMany({ where: fromBranchSale, select: { id: true } }));

    const purchaseIds = ids(await tx.purchase.findMany({ where: inBranch, select: { id: true } }));
    const fromBranchPurchase = {
        tenant_id: tenantId,
        OR: [{ store_id: storeId }, { purchase: { store_id: storeId } }],
    };
    const purchaseReturnIds = ids(await tx.purchaseReturn.findMany({ where: fromBranchPurchase, select: { id: true } }));
    const purchaseOrderIds = ids(await tx.purchaseOrder.findMany({ where: inBranch, select: { id: true } }));

    const shrinkageIds = ids(await tx.inventoryShrinkage.findMany({ where: inBranchWarehouse, select: { id: true } }));
    const stockTakeIds = ids(await tx.stockTakeSession.findMany({ where: inBranchWarehouse, select: { id: true } }));
    const transferWhere = {
        tenant_id: tenantId,
        OR: [{ source_warehouse_id: { in: warehouseIds } }, { destination_warehouse_id: { in: warehouseIds } }],
    };
    const warehouseTransferIds = ids(await tx.warehouseTransfer.findMany({ where: transferWhere, select: { id: true } }));

    const fundTransferWhere = { tenant_id: tenantId, OR: [{ source_store_id: storeId }, { destination_store_id: storeId }] };
    const fundTransfers = await tx.fundTransfer.findMany({
        where: fundTransferWhere,
        select: { id: true, source_voucher_id: true, destination_voucher_id: true },
    });

    const expenseIds = ids(await tx.expenseEntry.findMany({ where: inBranch, select: { id: true } }));
    const loanIds = ids(await tx.loan.findMany({ where: inBranch, select: { id: true } }));
    const loanPaymentIds = ids(
        await findChunked(loanIds, (chunk) => tx.loanPayment.findMany({ where: { loan_id: { in: chunk } }, select: { id: true } })),
    );

    const profitRunIds = ids(await tx.investorProfitRun.findMany({ where: inBranch, select: { id: true } }));
    const profitShareIds = ids(
        await findChunked(profitRunIds, (chunk) =>
            tx.investorProfitShare.findMany({ where: { run_id: { in: chunk } }, select: { id: true } }),
        ),
    );

    const sessionIds = ids(await tx.cashierSession.findMany({ where: inBranch, select: { id: true } }));
    const cashTransactionIds = ids(
        await findChunked(sessionIds, (chunk) =>
            tx.cashTransaction.findMany({ where: { session_id: { in: chunk } }, select: { id: true } }),
        ),
    );

    // Ledger rows the deleted documents wrote on a customer's or supplier's
    // account.
    const customerRows = [
        ...(await findChunked(saleIds, (chunk) =>
            tx.customerCreditTransaction.findMany({
                where: { tenant_id: tenantId, reference_type: 'SALE', reference_id: { in: chunk } },
                select: { id: true, customer_id: true, type: true, amount: true, discount_amount: true },
            }),
        )),
        ...(await findChunked(salesReturnIds, (chunk) =>
            tx.customerCreditTransaction.findMany({
                where: { tenant_id: tenantId, reference_type: 'SALES_RETURN', reference_id: { in: chunk } },
                select: { id: true, customer_id: true, type: true, amount: true, discount_amount: true },
            }),
        )),
    ];
    const supplierRows = [
        ...(await findChunked(purchaseIds, (chunk) =>
            tx.supplierCreditTransaction.findMany({
                where: { tenant_id: tenantId, reference_type: 'PURCHASE', reference_id: { in: chunk } },
                select: { id: true, supplier_id: true, type: true, amount: true, discount_amount: true },
            }),
        )),
        ...(await findChunked(purchaseReturnIds, (chunk) =>
            tx.supplierCreditTransaction.findMany({
                where: { tenant_id: tenantId, reference_type: 'PURCHASE_RETURN', reference_id: { in: chunk } },
                select: { id: true, supplier_id: true, type: true, amount: true, discount_amount: true },
            }),
        )),
    ];
    // And the branch's rows no document stands behind (see above). A write-off
    // names its reason in `reference_id`, not a document, so it counts too.
    const unattached = {
        tenant_id: tenantId,
        store_id: storeId,
        OR: [{ reference_type: null }, { reference_type: 'BAD_DEBT' }],
    };
    customerRows.push(...(await tx.customerCreditTransaction.findMany({
        where: unattached,
        select: { id: true, customer_id: true, type: true, amount: true, discount_amount: true },
    })));
    supplierRows.push(...(await tx.supplierCreditTransaction.findMany({
        where: unattached,
        select: { id: true, supplier_id: true, type: true, amount: true, discount_amount: true },
    })));
    // What those supplier payments had paid on bills. Deleting the payment
    // cascades the allocation away, but the bill's `paid_amount` is a running
    // total that has to be handed back by hand — for a bill that survives.
    const deletedPurchases = new Set(purchaseIds);
    const allocations = (
        await findChunked(supplierRows.map((r) => r.id), (chunk) =>
            tx.supplierPaymentAllocation.findMany({
                where: { transaction_id: { in: chunk } },
                select: { purchase_id: true, amount: true },
            }),
        )
    ).filter((a) => !deletedPurchases.has(a.purchase_id));

    const loyaltyRows = await findChunked(saleIds, (chunk) =>
        tx.loyaltyTransaction.findMany({
            where: { tenantId, saleId: { in: chunk } },
            select: { id: true, customerId: true, points: true },
        }),
    );

    // Every voucher is tied to its document by `source_id`, and the ids are
    // UUIDs, so one list covers every document type at once.
    const sourceIds = [
        ...saleIds,
        ...salesReturnIds,
        ...purchaseIds,
        ...purchaseReturnIds,
        ...purchaseOrderIds,
        ...shrinkageIds,
        ...stockTakeIds,
        ...warehouseTransferIds,
        ...ids(fundTransfers),
        ...expenseIds,
        ...loanIds,
        ...loanPaymentIds,
        ...profitShareIds,
        ...cashTransactionIds,
        ...customerRows.map((r) => r.id),
        ...supplierRows.map((r) => r.id),
    ];

    // --- Delete, dependents first ---

    // CRM. Deleting a lead cascades its conversations, follow-ups and activities.
    await tx.crmActivity.deleteMany({ where: inBranch });
    await tx.crmFollowUp.deleteMany({ where: inBranch });
    await tx.customerInteraction.deleteMany({ where: inBranch });
    await tx.lead.deleteMany({ where: inBranch });

    await chunked(customerRows.map((r) => r.id), (chunk) =>
        tx.customerCreditTransaction.deleteMany({ where: { id: { in: chunk } } }),
    );
    await chunked(supplierRows.map((r) => r.id), (chunk) =>
        tx.supplierCreditTransaction.deleteMany({ where: { id: { in: chunk } } }),
    );
    await chunked(loyaltyRows.map((r) => r.id), (chunk) =>
        tx.loyaltyTransaction.deleteMany({ where: { id: { in: chunk } } }),
    );

    // Records referencing Sale, then sales.
    await tx.warrantyClaim.deleteMany({ where: fromBranchSale });
    await chunked(saleIds, (chunk) => tx.deliveryOrder.deleteMany({ where: { tenantId, saleId: { in: chunk } } }));
    await tx.salesReturn.deleteMany({ where: fromBranchSale }); // cascades SalesReturnItem
    await tx.sale.deleteMany({ where: inBranch }); // cascades SaleItem, PaymentRecord
    await tx.quotation.deleteMany({ where: inBranch }); // cascades QuotationItem
    await tx.salesOrder.deleteMany({ where: inBranch }); // cascades SalesOrderItem, OrderDeposit

    // Purchases.
    await tx.purchaseReturn.deleteMany({ where: fromBranchPurchase }); // cascades PurchaseReturnItem
    await tx.purchase.deleteMany({ where: inBranch }); // cascades PurchaseItem, PurchasePayment, allocations
    await tx.purchaseOrder.deleteMany({ where: inBranch }); // cascades PurchaseOrderItem
    await tx.purchaseQuotation.deleteMany({ where: inBranch }); // cascades PurchaseQuotationItem
    await tx.productDemand.deleteMany({
        where: { tenant_id: tenantId, OR: [{ store_id: storeId }, { warehouse_id: { in: warehouseIds } }] },
    }); // cascades ProductDemandItem

    // Inventory. A cross-branch transfer's movements in the other branch's
    // warehouse go with the transfer.
    await tx.inventoryMovement.deleteMany({ where: inBranchWarehouse });
    await chunked(warehouseTransferIds, (chunk) =>
        tx.inventoryMovement.deleteMany({ where: { tenant_id: tenantId, reference_id: { in: chunk } } }),
    );
    await tx.inventoryShrinkage.deleteMany({ where: inBranchWarehouse }); // cascades InventoryShrinkageItem
    await tx.warehouseTransfer.deleteMany({ where: transferWhere }); // cascades WarehouseTransferItem
    await tx.stockTakeSession.deleteMany({ where: inBranchWarehouse }); // cascades StockTakeCountLine
    await tx.productSerial.deleteMany({ where: inBranch });

    // Records pointing at a voucher, before the vouchers.
    await tx.fundTransfer.deleteMany({ where: fundTransferWhere });
    await tx.investorProfitRun.deleteMany({ where: inBranch }); // cascades InvestorProfitShare

    // Accounting journals: what the documents above posted, wherever it was
    // attributed, and the branch's own manual entries.
    const transferVoucherIds = fundTransfers
        .flatMap((t) => [t.source_voucher_id, t.destination_voucher_id])
        .filter((id): id is string => !!id);
    await chunked(transferVoucherIds, (chunk) =>
        tx.voucher.deleteMany({ where: { tenant_id: tenantId, id: { in: chunk } } }),
    );
    await chunked(sourceIds, (chunk) =>
        tx.voucher.deleteMany({ where: { tenant_id: tenantId, source_id: { in: chunk } } }),
    ); // cascades VoucherDetail
    await tx.voucher.deleteMany({ where: { ...inBranch, source_type: null } });

    // Financials, HR and sessions.
    await tx.expenseEntry.deleteMany({ where: inBranch });
    await tx.loan.deleteMany({ where: inBranch }); // cascades LoanPayment
    await tx.attendanceRecord.deleteMany({ where: inBranch });
    await tx.cashierSession.deleteMany({ where: inBranch }); // cascades CashTransaction

    // --- Running balances the deleted ledger rows had moved ---

    const customerDue = sumBy(
        customerRows,
        (r) => r.customer_id,
        (r) => customerLedgerDueDelta(r.type, Number(r.amount), Number(r.discount_amount ?? 0)),
    );
    for (const [customerId, delta] of customerDue) {
        if (Math.abs(delta) < 0.005) continue;
        await tx.customer.update({ where: { id: customerId }, data: { due_balance: { decrement: delta } } });
    }

    const supplierDue = sumBy(
        supplierRows,
        (r) => r.supplier_id,
        (r) => supplierLedgerDueDelta(r.type, Number(r.amount), Number(r.discount_amount ?? 0)),
    );
    for (const [supplierId, delta] of supplierDue) {
        if (Math.abs(delta) < 0.005) continue;
        await tx.supplier.update({ where: { id: supplierId }, data: { due_balance: { decrement: delta } } });
    }

    const paidBack = sumBy(allocations, (a) => a.purchase_id, (a) => Number(a.amount));
    for (const [purchaseId, amount] of paidBack) {
        const bill = await tx.purchase.findUnique({
            where: { id: purchaseId },
            select: { total_amount: true, paid_amount: true },
        });
        if (!bill) continue;
        const paid = Number(bill.paid_amount) - amount;
        await tx.purchase.update({
            where: { id: purchaseId },
            data: { paid_amount: paid, payment_status: purchasePaymentStatus(paid, Number(bill.total_amount)) },
        });
    }

    const loyalty = sumBy(loyaltyRows, (r) => r.customerId, (r) => r.points);
    for (const [customerId, points] of loyalty) {
        if (points === 0) continue;
        await tx.customer.update({ where: { id: customerId }, data: { loyalty_points: { decrement: points } } });
    }
}

/** The master data one branch has of its own. Products are shared by every branch. */
export type BranchDataGroup = 'customers' | 'suppliers' | 'stock';

/** The ids in `partyIds` that some row found by any of `lookups` still points at. */
async function stillReferenced(
    partyIds: string[],
    lookups: Array<(chunk: string[]) => Promise<Array<string | null>>>,
): Promise<Set<string>> {
    const used = new Set<string>();
    for (const lookup of lookups) {
        await chunked(partyIds, async (chunk) => {
            for (const id of await lookup(chunk)) if (id) used.add(id);
        });
    }
    return used;
}

/**
 * Clear Data's "all" mode for one branch, run after `clearBranchTransactions`
 * in the same transaction: the master data that belongs to the branch, in the
 * groups asked for.
 *
 * A customer or supplier of the branch that something still points at once
 * the branch's transactions are gone — a sale or purchase at another branch, a
 * payment recorded there before they moved, a project — is kept and counted:
 * deleting them would leave that record with no party. Stock goes by warehouse,
 * and every warehouse belongs to one branch.
 */
export async function clearBranchMasterData(
    tx: Tx,
    tenantId: string,
    storeId: string,
    groups: ReadonlySet<BranchDataGroup>,
): Promise<{ keptCustomers: number; keptSuppliers: number }> {
    const inBranch = { tenant_id: tenantId, store_id: storeId };
    let keptCustomers = 0;
    let keptSuppliers = 0;

    if (groups.has('customers')) {
        const customerIds = ids(await tx.customer.findMany({ where: inBranch, select: { id: true } }));
        const byCustomer = (chunk: string[]) => ({ customer_id: { in: chunk } });
        const pick = (rows: { customer_id: string | null }[]) => rows.map((r) => r.customer_id);
        const used = await stillReferenced(customerIds, [
            async (c) => pick(await tx.sale.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.salesOrder.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.quotation.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.warrantyClaim.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.project.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.customerCreditTransaction.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.crmActivity.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.crmFollowUp.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => pick(await tx.customerInteraction.findMany({ where: byCustomer(c), select: { customer_id: true }, distinct: ['customer_id'] })),
            async (c) => (await tx.lead.findMany({
                where: { converted_customer_id: { in: c } },
                select: { converted_customer_id: true },
                distinct: ['converted_customer_id'],
            })).map((r) => r.converted_customer_id),
        ]);
        const deletable = customerIds.filter((id) => !used.has(id));
        // Cascades whatever loyalty and campaign rows are left.
        await chunked(deletable, (chunk) => tx.customer.deleteMany({ where: { id: { in: chunk } } }));
        keptCustomers = customerIds.length - deletable.length;
    }

    if (groups.has('suppliers')) {
        const supplierIds = ids(await tx.supplier.findMany({ where: inBranch, select: { id: true } }));
        const bySupplier = (chunk: string[]) => ({ supplier_id: { in: chunk } });
        const pick = (rows: { supplier_id: string | null }[]) => rows.map((r) => r.supplier_id);
        const used = await stillReferenced(supplierIds, [
            async (c) => pick(await tx.purchase.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
            async (c) => pick(await tx.purchaseReturn.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
            async (c) => pick(await tx.purchaseOrder.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
            async (c) => pick(await tx.purchaseQuotation.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
            async (c) => pick(await tx.importShipment.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
            async (c) => pick(await tx.supplierCreditTransaction.findMany({ where: bySupplier(c), select: { supplier_id: true }, distinct: ['supplier_id'] })),
        ]);
        const deletable = supplierIds.filter((id) => !used.has(id));
        await chunked(deletable, (chunk) => tx.supplier.deleteMany({ where: { id: { in: chunk } } }));
        keptSuppliers = supplierIds.length - deletable.length;
    }

    if (groups.has('stock')) {
        const warehouseIds = ids(await tx.warehouse.findMany({ where: inBranch, select: { id: true } }));
        await tx.productStock.deleteMany({ where: { tenant_id: tenantId, warehouse_id: { in: warehouseIds } } });
    }

    return { keptCustomers, keptSuppliers };
}
