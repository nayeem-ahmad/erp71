import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { SALES_READ } from '../auth/permission-sets';
import { SalesReportsController } from './sales-reports.controller';

describe('SalesReportsController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service: Record<string, jest.Mock> = {
        getBranchReport: jest.fn(),
    };
    const lineItems = { getSalesLineItems: jest.fn() };
    const branchScope = { resolveStoreId: jest.fn() };
    const controller = new SalesReportsController(service as any, lineItems as any, branchScope as any);

    beforeEach(() => jest.clearAllMocks());

    describe('line items', () => {
        it('hands the service the resolved branch', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await controller.getSalesLineItems(tenant, { storeId: 's1' } as any);
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's1', { permissions: SALES_READ });
            expect(lineItems.getSalesLineItems).toHaveBeenCalledWith('t1', expect.objectContaining({ storeId: 's1' }), 'Asia/Dhaka');
        });

        // Regression: `?storeId=` was trusted as sent.
        it('refuses a branch the caller cannot use before reading', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(controller.getSalesLineItems(tenant, { storeId: 'foreign' } as any)).rejects.toBeInstanceOf(
                ForbiddenException,
            );
            expect(lineItems.getSalesLineItems).not.toHaveBeenCalled();
        });
    });

    describe('branch report', () => {
        it('is one branch: omitted resolves to the header branch', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await controller.getBranchReport(tenant, { from: '2026-09-01' });
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, undefined, {
                permissions: [StorePermission.VIEW_FINANCIAL_REPORTS],
                allowAll: false,
            });
            expect(service.getBranchReport).toHaveBeenCalledWith('t1', { from: '2026-09-01', storeId: 's1' });
        });

        // Regression: the branch was checked against the tenant only.
        it('refuses a branch the caller cannot use', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(controller.getBranchReport(tenant, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
            expect(service.getBranchReport).not.toHaveBeenCalled();
        });

        it("refuses 'all'", async () => {
            branchScope.resolveStoreId.mockRejectedValue(new BadRequestException());
            await expect(controller.getBranchReport(tenant, { storeId: 'all' })).rejects.toBeInstanceOf(BadRequestException);
            expect(service.getBranchReport).not.toHaveBeenCalled();
        });
    });
});
