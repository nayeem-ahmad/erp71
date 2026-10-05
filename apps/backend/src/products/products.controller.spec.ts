import { ForbiddenException } from '@nestjs/common';
import { CATALOG_READ } from '../auth/permission-sets';
import { ProductsController } from './products.controller';

describe('ProductsController — low-stock count branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { countLowStock: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new ProductsController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('counts for the resolved branch', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.countLowStock(tenant, {});
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, { permissions: CATALOG_READ });
        expect(service.countLowStock).toHaveBeenCalledWith('t1', 's1');
    });

    it('refuses a branch the caller cannot use', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.countLowStock(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.countLowStock).not.toHaveBeenCalled();
    });
});
