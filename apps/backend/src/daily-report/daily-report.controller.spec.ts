import { NotFoundException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { DailyReportController } from './daily-report.controller';

describe('DailyReportController', () => {
    const service = { getReport: jest.fn() };
    const db = { store: { findFirst: jest.fn() }, tenant: { findUnique: jest.fn() } };
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
    });

    it('404s a store that is not this tenant before aggregating', async () => {
        db.store.findFirst.mockResolvedValue(null);
        const controller = new DailyReportController(service as any, db as any);
        await expect(controller.get(tenant as any, { storeId: 'other-store' })).rejects.toBeInstanceOf(NotFoundException);
        expect(service.getReport).not.toHaveBeenCalled();
    });

    it('passes the active store and locale through', async () => {
        const controller = new DailyReportController(service as any, db as any);
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

    it('gates GET on VIEW_FINANCIAL_REPORTS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, DailyReportController.prototype.get)).toEqual([
            StorePermission.VIEW_FINANCIAL_REPORTS,
        ]);
    });
});
