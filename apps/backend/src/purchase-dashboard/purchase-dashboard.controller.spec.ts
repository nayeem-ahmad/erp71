import { ForbiddenException } from '@nestjs/common';
import { PURCHASE_READ } from '../auth/permission-sets';
import { PurchaseDashboardController } from './purchase-dashboard.controller';

describe('PurchaseDashboardController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { getOverview: jest.fn(), getTrends: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new PurchaseDashboardController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it.each(['getOverview', 'getTrends'] as const)('%s hands the service the resolved branch', async (method) => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller[method](tenant, { from: '2026-09-01' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, { permissions: PURCHASE_READ });
        expect(service[method]).toHaveBeenCalledWith('t1', { from: '2026-09-01', storeId: 's1' }, 'Asia/Dhaka');
    });

    it.each(['getOverview', 'getTrends'] as const)("%s turns 'all' into the whole tenant", async (method) => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);
        await controller[method](tenant, { storeId: 'all' });
        expect(service[method]).toHaveBeenCalledWith('t1', { storeId: undefined }, 'Asia/Dhaka');
    });

    it.each(['getOverview', 'getTrends'] as const)('%s refuses a branch the caller cannot use', async (method) => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller[method](tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service[method]).not.toHaveBeenCalled();
    });
});
