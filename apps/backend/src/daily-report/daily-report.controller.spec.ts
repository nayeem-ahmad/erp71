import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { DailyReportController } from './daily-report.controller';

describe('DailyReportController', () => {
    const service = { getReport: jest.fn() };
    const db = { store: { findFirst: jest.fn() }, tenant: { findUnique: jest.fn() } };
    const branchScope = { resolveStoreId: jest.fn() };
    const tenant = {
        tenantId: 't1',
        storeId: 's1',
        userId: 'u1',
        timezone: 'Asia/Dhaka',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        db.store.findFirst.mockResolvedValue({ id: 's1', name: 'Main', tenant_id: 't1' });
        db.tenant.findUnique.mockResolvedValue({ name: 'Karim Electronics' });
        service.getReport.mockResolvedValue({ sales: { net: 1 } });
        branchScope.resolveStoreId.mockImplementation(async (ctx: any, requested?: string) => requested || ctx.storeId);
    });

    const make = () => new DailyReportController(service as any, db as any, branchScope as any);

    it('404s a store that is not this tenant before aggregating', async () => {
        db.store.findFirst.mockResolvedValue(null);
        const controller = make();
        await expect(controller.get(tenant as any, { storeId: 'other-store' })).rejects.toBeInstanceOf(NotFoundException);
        expect(service.getReport).not.toHaveBeenCalled();
    });

    it('passes the active store and locale through', async () => {
        const controller = make();
        await controller.get(tenant as any, { date: '2026-10-01', locale: 'bn' });
        expect(service.getReport).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 't1',
                storeId: 's1',
                date: '2026-10-01',
                locale: 'bn',
                timezone: 'Asia/Dhaka',
                storeName: 'Main',
                tenantName: 'Karim Electronics',
            }),
        );
    });

    it('checks a query branch against the caller, one branch only, before reading it', async () => {
        await make().get(tenant as any, { storeId: 's2' });
        expect(branchScope.resolveStoreId).toHaveBeenCalledWith(tenant, 's2', {
            permissions: [StorePermission.VIEW_FINANCIAL_REPORTS],
            allowAll: false,
        });
    });

    // Regression: `query.storeId || tenant.storeId` let a member of s1 read any
    // other branch's daily report by naming it.
    it("refuses a branch the caller cannot use without aggregating it", async () => {
        branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException('You do not have access to this branch'));
        await expect(make().get(tenant as any, { storeId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(db.store.findFirst).not.toHaveBeenCalled();
        expect(service.getReport).not.toHaveBeenCalled();
    });

    it("refuses 'all' — the daily report is one branch", async () => {
        branchScope.resolveStoreId.mockRejectedValue(new BadRequestException('This report covers one branch at a time.'));
        await expect(make().get(tenant as any, { storeId: 'all' })).rejects.toBeInstanceOf(BadRequestException);
        expect(service.getReport).not.toHaveBeenCalled();
    });

    it('gates GET on VIEW_FINANCIAL_REPORTS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, DailyReportController.prototype.get)).toEqual([
            StorePermission.VIEW_FINANCIAL_REPORTS,
        ]);
    });
});
