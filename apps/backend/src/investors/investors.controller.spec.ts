import { ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { InvestorsController } from './investors.controller';

describe('InvestorsController — profit-run scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service = { previewProfitRun: jest.fn(), createProfitRun: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn(), canSeeAllBranches: jest.fn() };
    const controller = new InvestorsController(service as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    // Regression: the service hard-coded consolidated access, so a member with
    // MANAGE_INVESTORS alone could read the company-wide P&L through a run.
    it("passes the caller's real whole-company answer, not a hard-coded true", async () => {
        branchScope.canSeeAllBranches.mockResolvedValue(false);
        await controller.previewProfitRun(tenant, { year: 2026, month: 7 });
        await controller.createProfitRun(tenant, { year: 2026, month: 7 });
        expect(service.previewProfitRun).toHaveBeenCalledWith('t1', { year: 2026, month: 7 }, false);
        expect(service.createProfitRun).toHaveBeenCalledWith('t1', 'u1', { year: 2026, month: 7 }, false);
        expect(branchScope.resolveStoreId).not.toHaveBeenCalled();
    });

    it("checks a branch run's id against the caller's branches", async () => {
        branchScope.canSeeAllBranches.mockResolvedValue(false);
        branchScope.resolveStoreId.mockResolvedValue('s1');
        await controller.previewProfitRun(tenant, { year: 2026, month: 7, storeId: 's1' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', {
            permissions: [StorePermission.MANAGE_INVESTORS],
            allowAll: false,
        });
        expect(service.previewProfitRun).toHaveBeenCalled();
    });

    it('refuses a branch run for a branch the caller cannot use', async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
        await expect(controller.createProfitRun(tenant, { year: 2026, month: 7, storeId: 'foreign' })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        expect(service.createProfitRun).not.toHaveBeenCalled();
    });
});
