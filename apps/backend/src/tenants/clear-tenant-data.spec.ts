jest.mock('@erp71/database', () => ({
    seedDefaultLeadTaxonomy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./clear-branch-data', () => ({
    clearBranchTransactions: jest.fn().mockResolvedValue(undefined),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { seedDefaultLeadTaxonomy } from '@erp71/database';
import { clearTenantData } from './clear-tenant-data';
import { clearBranchTransactions } from './clear-branch-data';

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

    it('refuses to clear all data of one branch — master data is shared', async () => {
        const { db } = makeDb();
        await expect(clearTenantData(db as any, 't1', 'all', 's1')).rejects.toBeInstanceOf(BadRequestException);
        expect(db.$transaction).not.toHaveBeenCalled();
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
});
