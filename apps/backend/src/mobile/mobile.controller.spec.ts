import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PURCHASE_READ, SALES_READ } from '../auth/permission-sets';
import { MobileController } from './mobile.controller';

describe('MobileController — pulse', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const pulse = { getPulse: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new MobileController(pulse as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('reads the branch the caller may use, with payables when they may read purchasing there', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');

        await controller.getPulse(tenant, { storeId: 's1' });

        expect(branchScope.resolveStoreId).toHaveBeenNthCalledWith(1, tenant, 's1', { permissions: SALES_READ });
        expect(branchScope.resolveStoreId).toHaveBeenNthCalledWith(2, tenant, 's1', { permissions: PURCHASE_READ });
        expect(pulse.getPulse).toHaveBeenCalledWith('t1', 's1', 'Asia/Dhaka', { includePayables: true });
    });

    it('leaves payables out for a sales-only member instead of refusing the screen', async () => {
        branchScope.resolveStoreId
            .mockResolvedValueOnce('s1')
            .mockRejectedValueOnce(new ForbiddenException());

        await controller.getPulse(tenant, {});

        expect(pulse.getPulse).toHaveBeenCalledWith('t1', 's1', 'Asia/Dhaka', { includePayables: false });
    });

    it('a whole-tenant pulse includes payables without a second check', async () => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);

        await controller.getPulse(tenant, { storeId: 'all' });

        expect(branchScope.resolveStoreId).toHaveBeenCalledTimes(1);
        expect(pulse.getPulse).toHaveBeenCalledWith('t1', undefined, 'Asia/Dhaka', { includePayables: true });
    });

    it('refuses a branch the caller cannot use before reading anything', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.getPulse(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(pulse.getPulse).not.toHaveBeenCalled();
    });

    it('does not swallow anything but a refusal from the purchasing check', async () => {
        branchScope.resolveStoreId
            .mockResolvedValueOnce('s1')
            .mockRejectedValueOnce(new BadRequestException());
        await expect(controller.getPulse(tenant, {})).rejects.toBeInstanceOf(BadRequestException);
        expect(pulse.getPulse).not.toHaveBeenCalled();
    });
});
