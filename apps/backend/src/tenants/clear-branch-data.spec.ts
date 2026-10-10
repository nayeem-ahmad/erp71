import { clearBranchTransactions } from './clear-branch-data';

/**
 * Every Prisma delegate the branch wipe touches, as a mock that answers
 * `findMany` from `rows` and records every call.
 */
function makeTx(rows: Record<string, any[]> = {}) {
    const models = [
        'warehouse', 'sale', 'salesReturn', 'purchase', 'purchaseReturn', 'purchaseOrder',
        'inventoryShrinkage', 'stockTakeSession', 'warehouseTransfer', 'fundTransfer', 'expenseEntry',
        'loan', 'loanPayment', 'investorProfitRun', 'investorProfitShare', 'cashierSession',
        'cashTransaction', 'customerCreditTransaction', 'supplierCreditTransaction', 'loyaltyTransaction',
        'crmActivity', 'crmFollowUp', 'customerInteraction', 'lead', 'warrantyClaim', 'deliveryOrder',
        'quotation', 'salesOrder', 'purchaseQuotation', 'productDemand', 'inventoryMovement',
        'productSerial', 'voucher', 'attendanceRecord', 'customer', 'supplier',
    ];
    const tx: Record<string, any> = {};
    for (const model of models) {
        tx[model] = {
            findMany: jest.fn(async ({ where }: any) => {
                const source = rows[model] ?? [];
                // Ledger rows are looked up per reference type; answer only the
                // ones asked for.
                if (where?.reference_type) return source.filter((r) => r.reference_type === where.reference_type);
                return source;
            }),
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
});
