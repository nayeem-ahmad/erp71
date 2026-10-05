import { ForbiddenException } from '@nestjs/common';
import { INVENTORY_REPORT_READ } from '../auth/permission-sets';
import { InventoryReportsController } from './inventory-reports.controller';

describe('InventoryReportsController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = {
        getReorderSuggestions: jest.fn(),
        getInventoryValuation: jest.fn(),
        getStockOnHand: jest.fn(),
        getStockAging: jest.fn(),
        getShrinkageSummary: jest.fn(),
        getProductTransactionHistory: jest.fn(),
    };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new InventoryReportsController(service as any, branchScope as any);

    const calls: Array<[keyof typeof service, (query: any) => Promise<unknown>]> = [
        ['getReorderSuggestions', (q) => controller.getReorderSuggestions(tenant, q)],
        ['getInventoryValuation', (q) => controller.getInventoryValuation(tenant, q)],
        ['getStockOnHand', (q) => controller.getStockOnHand(tenant, q)],
        ['getStockAging', (q) => controller.getStockAging(tenant, q)],
        ['getShrinkageSummary', (q) => controller.getShrinkageSummary(tenant, q)],
        ['getProductTransactionHistory', (q) => controller.getProductTransactionHistory(tenant, q)],
    ];

    beforeEach(() => jest.clearAllMocks());

    it.each(calls)('%s hands the service the resolved branch, keeping the warehouse filter', async (method, call) => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await call({ storeId: 's1', warehouseId: 'w1' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: INVENTORY_REPORT_READ });
        expect(service[method].mock.calls[0][1]).toEqual(expect.objectContaining({ storeId: 's1', warehouseId: 'w1' }));
    });

    it.each(calls)("%s turns 'all' into the whole tenant", async (method, call) => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);
        await call({ storeId: 'all' });
        expect(service[method].mock.calls[0][1].storeId).toBeUndefined();
    });

    // Regression: `?storeId=<another branch>` used to be trusted as sent.
    it.each(calls)('%s refuses a branch the caller cannot use before reading', async (method, call) => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException('You do not have access to this branch'));
        await expect(call({ storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service[method]).not.toHaveBeenCalled();
    });
});
