import { ForbiddenException } from '@nestjs/common';
import { COUNTER_READ, COUNTER_WRITE } from '../auth/permission-sets';
import { CountersController } from './counters.controller';

describe('CountersController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { create: jest.fn(), findByStore: jest.fn(), findActive: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new CountersController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('lists counters for the resolved branch (the header when omitted)', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.findByStore(tenant, undefined);
        await controller.findActive(tenant, 's1');
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, { permissions: COUNTER_READ, allowAll: false });
        expect(service.findByStore).toHaveBeenCalledWith('t1', 's1');
        expect(service.findActive).toHaveBeenCalledWith('t1', 's1');
    });

    // Regression: `?storeId=` was passed straight to the query.
    it('refuses a foreign branch before listing', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.findByStore(tenant, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.findActive(tenant, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.findByStore).not.toHaveBeenCalled();
        expect(service.findActive).not.toHaveBeenCalled();
    });

    it('creates a counter only in a branch the caller may manage', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(
            controller.create(tenant, { storeId: 'foreign', name: 'Till', counterNumber: 1 }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.create).not.toHaveBeenCalled();
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 'foreign', { permissions: COUNTER_WRITE, allowAll: false });
    });
});
