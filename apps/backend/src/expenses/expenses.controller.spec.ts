import { ForbiddenException } from '@nestjs/common';
import { EXPENSE_READ } from '../auth/permission-sets';
import { ExpensesController } from './expenses.controller';

describe('ExpensesController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { listEntries: jest.fn(), getSummary: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new ExpensesController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    it('entries and summary hand the service the resolved branch', async () => {
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.listEntries(tenant, { page: 1 } as any);
        await controller.getSummary(tenant, { storeId: 's1', from: '2026-09-01' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, { permissions: EXPENSE_READ });
        expect(service.listEntries).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1', timezone: 'Asia/Dhaka' }));
        expect(service.getSummary).toHaveBeenCalledWith('t1', { storeId: 's1', from: '2026-09-01' });
    });

    it("turns 'all' into the whole tenant", async () => {
        branchScope.resolveStoreId.mockResolvedValue(undefined);
        await controller.getSummary(tenant, { storeId: 'all' });
        expect(service.getSummary).toHaveBeenCalledWith('t1', { storeId: undefined });
    });

    it('refuses a branch the caller cannot use before reading', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.listEntries(tenant, { storeId: 'foreign' } as any)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.getSummary(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(service.listEntries).not.toHaveBeenCalled();
        expect(service.getSummary).not.toHaveBeenCalled();
    });
});
