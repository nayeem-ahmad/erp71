import { ForbiddenException } from '@nestjs/common';
import { FUND_READ } from '../auth/permission-sets';
import { FundTransfersController } from './fund-transfers.controller';

describe('FundTransfersController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { list: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new FundTransfersController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('hands the service the resolved branch (source OR destination)', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.list(tenant, { storeId: 's1', sourceStoreId: 's9' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledTimes(1);
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: FUND_READ });
        // With a branch resolved, a source filter only narrows within it.
        expect(service.list).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1', sourceStoreId: 's9' }));
    });

    it('checks source and destination ids when the whole tenant is in view', async () => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);
        await controller.list(tenant, { storeId: 'all', sourceStoreId: 's2', destinationStoreId: 's3' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's2', { permissions: FUND_READ });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's3', { permissions: FUND_READ });
        expect(service.list).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: undefined }));
    });

    it('refuses a branch the caller cannot use before reading', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.list(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.list).not.toHaveBeenCalled();
    });
});
