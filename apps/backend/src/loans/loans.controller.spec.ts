import { ForbiddenException } from '@nestjs/common';
import { LOANS_READ } from '../auth/permission-sets';
import { LoansController } from './loans.controller';

describe('LoansController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { listLoans: jest.fn(), getSummary: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new LoansController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('list and summary hand the service the resolved branch', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.list(tenant, { storeId: 's1' } as any);
        await controller.getSummary(tenant, {});
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: LOANS_READ });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, { permissions: LOANS_READ });
        expect(service.listLoans).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1' }));
        expect(service.getSummary).toHaveBeenCalledWith('t1', 's1');
    });

    it('refuses a branch the caller cannot use before reading', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.getSummary(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.list(tenant, { storeId: 'foreign' } as any)).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.getSummary).not.toHaveBeenCalled();
        expect(service.listLoans).not.toHaveBeenCalled();
    });
});
