import { ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { MushakController } from './mushak.controller';

describe('MushakController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { getSalesBook: jest.fn(), getLargeSupplyStatement: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new MushakController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it.each([
        ['getSalesBook', (q: any) => controller.getSalesBook(tenant, q)],
        ['getLargeSupplyStatement', (q: any) => controller.getLargeSupplyStatement(tenant, q)],
    ] as const)('%s hands the service the resolved branch', async (method, call) => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await call({ from: '2026-09-01', storeId: 's1' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', {
            permissions: [StorePermission.VIEW_FINANCIAL_REPORTS],
        });
        expect(service[method]).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1' }), 'Asia/Dhaka');
    });

    // Regression: a member could pull another branch's VAT book by naming it.
    it.each([
        ['getSalesBook', (q: any) => controller.getSalesBook(tenant, q)],
        ['getLargeSupplyStatement', (q: any) => controller.getLargeSupplyStatement(tenant, q)],
    ] as const)('%s refuses a branch the caller cannot use', async (method, call) => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(call({ storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service[method]).not.toHaveBeenCalled();
    });
});
