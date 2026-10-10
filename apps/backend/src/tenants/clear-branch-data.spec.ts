import { clearBranchMasterData, clearBranchTransactions } from './clear-branch-data';

/**
 * The parts of a Prisma `where` the ledger lookups use. A key the row does not
 * carry (tenant, a relation filter) passes, so a fixture only spells out what a
 * test is about.
 */
function matches(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, cond]: [string, any]) => {
        if (key === 'OR') return cond.some((c: any) => matches(row, c));
        if (!(key in row)) return true;
        if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[key]);
        return row[key] === cond;
    });
}

/**
 * Every Prisma delegate the branch wipe touches, as a mock that answers
 * `findMany`/`findUnique` from `rows` and records every call.
 */
function makeTx(rows: Record<string, any[]> = {}) {
    const models = [
        'warehouse', 'sale', 'salesReturn', 'purchase', 'purchaseReturn', 'purchaseOrder',
        'inventoryShrinkage', 'stockTakeSession', 'warehouseTransfer', 'fundTransfer', 'expenseEntry',
        'loan', 'loanPayment', 'investorProfitRun', 'investorProfitShare', 'cashierSession',
        'cashTransaction', 'customerCreditTransaction', 'supplierCreditTransaction', 'loyaltyTransaction',
        'crmActivity', 'crmFollowUp', 'customerInteraction', 'lead', 'warrantyClaim', 'deliveryOrder',
        'quotation', 'salesOrder', 'purchaseQuotation', 'productDemand', 'inventoryMovement',
        'productSerial', 'voucher', 'attendanceRecord', 'customer', 'supplier', 'supplierPaymentAllocation',
        'project', 'importShipment', 'productStock',
    ];
    const tx: Record<string, any> = {};
    for (const model of models) {
        tx[model] = {
            findMany: jest.fn(async ({ where }: any) => (rows[model] ?? []).filter((r) => matches(r, where))),
            findUnique: jest.fn(async ({ where }: any) => (rows[model] ?? []).find((r) => r.id === where.id) ?? null),
            deleteMany: jest.fn(async () => ({ count: 0 })),
            update: jest.fn(async () => ({})),
        };
    }
    return tx;
}

describe('clearBranchTransactions', () => {
    it('scopes every branch-owned delete to the branch and the tenant', async () => {
        const tx = makeTx();

        await clearBranchTransactions(tx as any, 't1', 's1');

        const inBranch = { tenant_id: 't1', store_id: 's1' };
        for (const model of ['sale', 'quotation', 'salesOrder', 'purchase', 'purchaseOrder', 'purchaseQuotation',
            'expenseEntry', 'loan', 'attendanceRecord', 'cashierSession', 'investorProfitRun', 'productSerial',
            'lead', 'crmActivity', 'crmFollowUp', 'customerInteraction']) {
            expect(tx[model].deleteMany).toHaveBeenCalledWith({ where: inBranch });
        }
        // Manual journals of the branch only; system-posted ones go by source.
        expect(tx.voucher.deleteMany).toHaveBeenCalledWith({ where: { ...inBranch, source_type: null } });
    });

    it('takes the vouchers a deleted document posted, including the other leg of a fund transfer', async () => {
        const tx = makeTx({
            sale: [{ id: 'sale-1' }],
            fundTransfer: [{ id: 'ft-1', source_voucher_id: 'v-src', destination_voucher_id: 'v-dst' }],
        });

        await clearBranchTransactions(tx as any, 't1', 's1');

        expect(tx.voucher.deleteMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', id: { in: ['v-src', 'v-dst'] } },
        });
        const bySource = tx.voucher.deleteMany.mock.calls.find(([arg]: any) => arg.where.source_id);
        expect(bySource[0].where.source_id.in).toEqual(expect.arrayContaining(['sale-1', 'ft-1']));
        // The transfer goes before the vouchers it points at.
        expect(tx.fundTransfer.deleteMany.mock.invocationCallOrder[0])
            .toBeLessThan(tx.voucher.deleteMany.mock.invocationCallOrder[0]);
    });

    it('moves a customer and a supplier due back by what the deleted ledger rows had moved it', async () => {
        const tx = makeTx({
            sale: [{ id: 'sale-1' }],
            purchase: [{ id: 'pur-1' }],
            customerCreditTransaction: [
                { id: 'cc-1', customer_id: 'c1', type: 'CREDIT_SALE', amount: 500, discount_amount: 0, reference_type: 'SALE' },
                { id: 'cc-2', customer_id: 'c1', type: 'PAYMENT', amount: 100, discount_amount: 0, reference_type: 'SALE' },
            ],
            supplierCreditTransaction: [
                { id: 'sc-1', supplier_id: 'p1', type: 'CREDIT_PURCHASE', amount: 800, discount_amount: 0, reference_type: 'PURCHASE' },
                { id: 'sc-2', supplier_id: 'p1', type: 'PAYMENT', amount: 300, discount_amount: 0, reference_type: 'PURCHASE' },
            ],
            loyaltyTransaction: [{ id: 'l-1', customerId: 'c1', points: 12 }],
        });

        await clearBranchTransactions(tx as any, 't1', 's1');

        expect(tx.customerCreditTransaction.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['cc-1', 'cc-2'] } } });
        expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { due_balance: { decrement: 400 } } });
        expect(tx.supplier.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { due_balance: { decrement: 500 } } });
        expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { loyalty_points: { decrement: 12 } } });
    });

    it('deletes returns pointing at a branch sale before the sale they would block', async () => {
        const tx = makeTx({ sale: [{ id: 'sale-1' }] });

        await clearBranchTransactions(tx as any, 't1', 's1');

        const fromBranchSale = { tenant_id: 't1', OR: [{ store_id: 's1' }, { sale: { store_id: 's1' } }] };
        expect(tx.salesReturn.deleteMany).toHaveBeenCalledWith({ where: fromBranchSale });
        expect(tx.salesReturn.deleteMany.mock.invocationCallOrder[0])
            .toBeLessThan(tx.sale.deleteMany.mock.invocationCallOrder[0]);
    });

    it('leaves balances alone when nothing on a party ledger was deleted', async () => {
        const tx = makeTx();

        await clearBranchTransactions(tx as any, 't1', 's1');

        expect(tx.customer.update).not.toHaveBeenCalled();
        expect(tx.supplier.update).not.toHaveBeenCalled();
    });

    it('deletes the payments, payouts, write-offs and opening balances recorded at the branch, with their vouchers', async () => {
        const tx = makeTx({
            customerCreditTransaction: [
                { id: 'cp-1', customer_id: 'c1', type: 'PAYMENT', amount: 200, discount_amount: 10, reference_type: null, store_id: 's1' },
                { id: 'cw-1', customer_id: 'c1', type: 'WRITE_OFF', amount: 50, discount_amount: 0, reference_type: 'BAD_DEBT', store_id: 's1' },
                { id: 'co-1', customer_id: 'c2', type: 'ADJUSTMENT', amount: 70, discount_amount: 0, reference_type: null, store_id: 's1' },
                // Another branch's payment stays.
                { id: 'cp-9', customer_id: 'c9', type: 'PAYMENT', amount: 999, discount_amount: 0, reference_type: null, store_id: 's2' },
            ],
            supplierCreditTransaction: [
                { id: 'sp-1', supplier_id: 'p1', type: 'PAYMENT', amount: 300, discount_amount: 0, reference_type: null, store_id: 's1' },
                { id: 'sp-2', supplier_id: 'p1', type: 'PAYOUT', amount: 40, discount_amount: 0, reference_type: null, store_id: 's1' },
            ],
        });

        await clearBranchTransactions(tx as any, 't1', 's1');

        const deletedCustomerRows = tx.customerCreditTransaction.deleteMany.mock.calls.flatMap(([a]: any) => a.where.id.in);
        expect(deletedCustomerRows.sort()).toEqual(['co-1', 'cp-1', 'cw-1']);
        const deletedSupplierRows = tx.supplierCreditTransaction.deleteMany.mock.calls.flatMap(([a]: any) => a.where.id.in);
        expect(deletedSupplierRows.sort()).toEqual(['sp-1', 'sp-2']);

        // Every leg a payment posted is keyed on the row's id.
        const bySource = tx.voucher.deleteMany.mock.calls.find(([arg]: any) => arg.where.source_id);
        expect(bySource[0].where.source_id.in).toEqual(expect.arrayContaining(['cp-1', 'cw-1', 'sp-1', 'sp-2']));
        expect(bySource[0].where.source_id.in).not.toContain('cp-9');

        // The payment had settled 210 and the write-off 50, so c1 owes 260 more;
        // the opening balance had raised c2's due by 70.
        expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { due_balance: { decrement: -260 } } });
        expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { due_balance: { decrement: 70 } } });
        expect(tx.supplier.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { due_balance: { decrement: -260 } } });
    });

    it('keeps a ledger row tied to a document that survives at another branch', async () => {
        const tx = makeTx({
            sale: [{ id: 'sale-1' }],
            customerCreditTransaction: [
                { id: 'cc-1', customer_id: 'c1', type: 'CREDIT_SALE', amount: 500, discount_amount: 0, reference_type: 'SALE', reference_id: 'sale-1', store_id: 's1' },
                // The branch's customer bought at another branch: the sale stays, so does its row.
                { id: 'cc-2', customer_id: 'c1', type: 'CREDIT_SALE', amount: 800, discount_amount: 0, reference_type: 'SALE', reference_id: 'sale-elsewhere', store_id: 's1' },
            ],
        });

        await clearBranchTransactions(tx as any, 't1', 's1');

        const deleted = tx.customerCreditTransaction.deleteMany.mock.calls.flatMap(([a]: any) => a.where.id.in);
        expect(deleted).toEqual(['cc-1']);
    });

    it('puts a bill at another branch back the way it was when a deleted payment had paid it', async () => {
        const tx = makeTx({
            purchase: [
                { id: 'pur-1' },
                { id: 'pur-elsewhere', store_id: 's2', total_amount: 500, paid_amount: 500 },
            ],
            supplierCreditTransaction: [
                { id: 'sp-1', supplier_id: 'p1', type: 'PAYMENT', amount: 400, discount_amount: 0, reference_type: null, store_id: 's1' },
            ],
            supplierPaymentAllocation: [
                { transaction_id: 'sp-1', purchase_id: 'pur-elsewhere', amount: 300 },
                // The branch's own bill goes anyway; its allocation needs no repair.
                { transaction_id: 'sp-1', purchase_id: 'pur-1', amount: 100 },
            ],
        });

        await clearBranchTransactions(tx as any, 't1', 's1');

        expect(tx.purchase.update).toHaveBeenCalledTimes(1);
        expect(tx.purchase.update).toHaveBeenCalledWith({
            where: { id: 'pur-elsewhere' },
            data: { paid_amount: 200, payment_status: 'PARTIAL' },
        });
    });
});

describe('clearBranchMasterData', () => {
    it("deletes the branch's customers, keeping one with a record elsewhere", async () => {
        const tx = makeTx({
            customer: [
                { id: 'c1', store_id: 's1' },
                { id: 'c2', store_id: 's1' },
                { id: 'c3', store_id: 's1' },
            ],
            // c2 bought at another branch; c3 has a payment recorded there before it moved.
            sale: [{ id: 'sale-elsewhere', customer_id: 'c2' }],
            customerCreditTransaction: [{ id: 'cc-9', customer_id: 'c3', store_id: 's2' }],
        });

        const result = await clearBranchMasterData(tx as any, 't1', 's1', new Set(['customers']));

        expect(tx.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenant_id: 't1', store_id: 's1' } }));
        expect(tx.customer.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } } });
        expect(result).toEqual({ keptCustomers: 2, keptSuppliers: 0 });
        expect(tx.supplier.deleteMany).not.toHaveBeenCalled();
        expect(tx.productStock.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes the branch's suppliers, keeping one with a purchase elsewhere", async () => {
        const tx = makeTx({
            supplier: [{ id: 'p1', store_id: 's1' }, { id: 'p2', store_id: 's1' }],
            purchase: [{ id: 'pur-elsewhere', supplier_id: 'p2' }],
        });

        const result = await clearBranchMasterData(tx as any, 't1', 's1', new Set(['suppliers']));

        expect(tx.supplier.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } } });
        expect(result).toEqual({ keptCustomers: 0, keptSuppliers: 1 });
        expect(tx.customer.deleteMany).not.toHaveBeenCalled();
    });

    it("clears the stock held in the branch's warehouses", async () => {
        const tx = makeTx({ warehouse: [{ id: 'w1' }, { id: 'w2' }] });

        await clearBranchMasterData(tx as any, 't1', 's1', new Set(['stock']));

        expect(tx.productStock.deleteMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', warehouse_id: { in: ['w1', 'w2'] } },
        });
        expect(tx.customer.deleteMany).not.toHaveBeenCalled();
    });
});
