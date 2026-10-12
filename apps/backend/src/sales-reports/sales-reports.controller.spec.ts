import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { SALES_READ } from '../auth/permission-sets';
import { SalesReportsController } from './sales-reports.controller';

describe('SalesReportsController — branch scope', () => {
    const tenant = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
    const service: Record<string, jest.Mock> = {
        getBranchReport: jest.fn(),
        getSalesSummary: jest.fn(),
        getSalesByProduct: jest.fn(),
        getSalesByCategory: jest.fn(),
        getSalesByCustomer: jest.fn(),
        getMonthlySalesByCustomer: jest.fn(),
        getSalesTrend: jest.fn(),
        getSalesBreakdown: jest.fn(),
        getTopMovers: jest.fn(),
        getReturnsAnalysis: jest.fn(),
        getCustomerRetention: jest.fn(),
        getGrossProfitByProduct: jest.fn(),
        getGrossProfitBySalesperson: jest.fn(),
        getMarginExceptions: jest.fn(),
        getMarginBridge: jest.fn(),
        getCostCoverage: jest.fn(),
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

    const FIN = [StorePermission.VIEW_FINANCIAL_REPORTS];
    const reports: Array<[string, readonly StorePermission[]]> = [
        ['getSalesSummary', SALES_READ],
        ['getSalesByProduct', SALES_READ],
        ['getSalesByCategory', SALES_READ],
        ['getSalesByCustomer', SALES_READ],
        ['getMonthlySalesByCustomer', SALES_READ],
        ['getSalesTrend', SALES_READ],
        ['getSalesBreakdown', SALES_READ],
        ['getTopMovers', FIN],
        ['getReturnsAnalysis', FIN],
        ['getCustomerRetention', [StorePermission.VIEW_CRM_INTERACTIONS]],
        ['getGrossProfitByProduct', FIN],
        ['getGrossProfitBySalesperson', FIN],
        ['getMarginExceptions', FIN],
        ['getMarginBridge', FIN],
        ['getCostCoverage', FIN],
    ];

    describe.each(reports)('%s', (method, permissions) => {
        const call = (query: any) => (controller as any)[method](tenant, query);

        it("hands the service the resolved branch, checked with the route's permissions", async () => {
            branchScope.resolveStoreId.mockResolvedValue('s2');
            await call({ storeId: 's2', from: '2026-09-01' });
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's2', { permissions });
            expect(service[method].mock.calls[0][1]).toEqual(expect.objectContaining({ storeId: 's2', from: '2026-09-01' }));
        });

        it("turns 'all' into the whole tenant", async () => {
            branchScope.resolveStoreId.mockResolvedValue(undefined);
            await call({ storeId: 'all' });
            expect(service[method].mock.calls[0][1].storeId).toBeUndefined();
        });

        it('refuses a branch the caller cannot use before reading', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(call({ storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
            expect(service[method]).not.toHaveBeenCalled();
        });
    });
});
