jest.mock('@erp71/database', () => ({
    seedDefaultLeadTaxonomy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./clear-branch-data', () => ({
    clearBranchTransactions: jest.fn().mockResolvedValue(undefined),
    clearBranchMasterData: jest.fn().mockResolvedValue({ keptCustomers: 2, keptSuppliers: 1 }),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { seedDefaultLeadTaxonomy } from '@erp71/database';
import { clearTenantData } from './clear-tenant-data';
import { clearBranchMasterData, clearBranchTransactions } from './clear-branch-data';

/** A transaction client that grows a mock delegate for whichever model is asked for. */
function makeTx() {
    const delegates: Record<string, any> = {};
    return new Proxy(delegates, {
        get(target, model: string) {
            target[model] ??= {
                deleteMany: jest.fn(async () => ({ count: 0 })),
                updateMany: jest.fn(async () => ({ count: 0 })),
            };
            return target[model];
        },
    });
}

function makeDb(store: { id: string; name: string } | null = { id: 's1', name: 'Uttara' }) {
    const tx = makeTx();
    const db = {
        store: { findFirst: jest.fn(async () => store) },
        $transaction: jest.fn(async (run: (t: any) => Promise<unknown>) => run(tx)),
    };
    return { db, tx };
}

describe('clearTenantData', () => {
    beforeEach(() => jest.clearAllMocks());

    it('refuses an unknown mode', async () => {
        const { db } = makeDb();
        await expect(clearTenantData(db as any, 't1', 'everything')).rejects.toBeInstanceOf(BadRequestException);
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a data group it does not know, or one a branch does not have', async () => {
        const { db } = makeDb();
        await expect(clearTenantData(db as any, 't1', 'all', undefined, ['everything'])).rejects.toBeInstanceOf(BadRequestException);
        // Products are shared by every branch.
        await expect(clearTenantData(db as any, 't1', 'all', 's1', ['products'])).rejects.toBeInstanceOf(BadRequestException);
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("clears all of one branch's data in one transaction, keeping what was asked", async () => {
        const { db, tx } = makeDb();

        const result = await clearTenantData(db as any, 't1', 'all', 's1', ['stock']);

        expect((clearBranchTransactions as jest.Mock).mock.calls[0][0]).toBe(tx);
        const [txArg, tenantArg, storeArg, groups] = (clearBranchMasterData as jest.Mock).mock.calls[0];
        expect(txArg).toBe(tx);
        expect([tenantArg, storeArg]).toEqual(['t1', 's1']);
        expect([...groups].sort()).toEqual(['customers', 'suppliers']);
        expect(db.$transaction).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            cleared: 'all', storeId: 's1', storeName: 'Uttara', kept: { customers: 2, suppliers: 1 },
        });
    });

    it('404s a branch of another tenant', async () => {
        const { db } = makeDb(null);
        await expect(clearTenantData(db as any, 't1', 'transactions', 's9')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.store.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's9', tenant_id: 't1' } }));
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('clears one branch in one transaction', async () => {
        const { db, tx } = makeDb();

        const result = await clearTenantData(db as any, 't1', 'transactions', 's1');

        const [txArg, ...args] = (clearBranchTransactions as jest.Mock).mock.calls[0];
        expect(txArg).toBe(tx);
        expect(args).toEqual(['t1', 's1']);
        expect(result).toEqual({ cleared: 'transactions', storeId: 's1', storeName: 'Uttara' });
    });

    it('clears every transaction of the tenant but keeps master data', async () => {
        const { db, tx } = makeDb();

        const result = await clearTenantData(db as any, 't1', 'transactions');

        expect(clearBranchTransactions).not.toHaveBeenCalled();
        expect(tx.sale.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.voucher.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.product.deleteMany).not.toHaveBeenCalled();
        expect(tx.customer.deleteMany).not.toHaveBeenCalled();
        expect(seedDefaultLeadTaxonomy).not.toHaveBeenCalled();
        expect(result).toEqual({ cleared: 'transactions' });
    });

    it('clears master data too in "all" mode, and reseeds the lead taxonomy', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'all');

        expect(tx.sale.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.product.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.customer.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        const [txArg, tenantArg] = (seedDefaultLeadTaxonomy as jest.Mock).mock.calls[0];
        expect(txArg).toBe(tx);
        expect(tenantArg).toBe('t1');
    });

    it('sets every customer and supplier balance back to zero when the shop-wide transactions go', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'transactions');

        expect(tx.customer.updateMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1' },
            data: { due_balance: 0, total_spent: 0, loyalty_points: 0, last_contacted_at: null, next_activity_date: null },
        });
        expect(tx.supplier.updateMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' }, data: { due_balance: 0 } });
    });

    it('clears import shipments with the transactions — their lines would block deleting products', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'transactions');

        expect(tx.importShipment.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    });

    it('keeps the master data groups asked for', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'all', undefined, ['customers', 'employees', 'products', 'stock']);

        expect(tx.customer.deleteMany).not.toHaveBeenCalled();
        expect(tx.employee.deleteMany).not.toHaveBeenCalled();
        expect(tx.product.deleteMany).not.toHaveBeenCalled();
        expect(tx.productStock.deleteMany).not.toHaveBeenCalled();
        // The CRM's lead options go with customers, so they stay too.
        expect(seedDefaultLeadTaxonomy).not.toHaveBeenCalled();
        expect(tx.supplier.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.fixedAsset.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        // Transactions always go.
        expect(tx.sale.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    });

    it('can keep the products and still clear their stock', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'all', undefined, ['products']);

        expect(tx.product.deleteMany).not.toHaveBeenCalled();
        expect(tx.productStock.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    });

    it('takes the stock with the products even when asked to keep the stock', async () => {
        const { db, tx } = makeDb();

        await clearTenantData(db as any, 't1', 'all', undefined, ['stock']);

        expect(tx.product.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
        expect(tx.productStock.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    });
});
