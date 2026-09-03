import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

describe('TenantsService — dashboard settings', () => {
    let service: TenantsService;

    const db = {
        tenant: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantsService,
                { provide: DatabaseService, useValue: db },
                { provide: PlanEntitlementsService, useValue: { assertEntitlement: jest.fn() } },
                {
                    provide: TenantTimezoneService,
                    useValue: {
                        for: jest.fn(async () => 'Asia/Dhaka'),
                        forMany: jest.fn(async () => new Map()),
                        prime: jest.fn(),
                        invalidate: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get(TenantsService);
    });

    it('returns the stored preference', async () => {
        db.tenant.findUnique.mockResolvedValue({ dashboard_preference: 'ACCOUNTING' });
        await expect(service.getDashboardSettings('tenant-1')).resolves.toEqual({
            dashboard_preference: 'ACCOUNTING',
        });
    });

    it('falls back to AUTO when the column holds something unrecognised', async () => {
        db.tenant.findUnique.mockResolvedValue({ dashboard_preference: 'LEGACY_VALUE' });
        await expect(service.getDashboardSettings('tenant-1')).resolves.toEqual({
            dashboard_preference: 'AUTO',
        });
    });

    it('rejects an unknown tenant', async () => {
        db.tenant.findUnique.mockResolvedValue(null);
        await expect(service.getDashboardSettings('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('lets an owner or manager change the workspace dashboard', async () => {
        db.tenant.update.mockResolvedValue({ dashboard_preference: 'ACCOUNTING' });

        await expect(
            service.updateDashboardSettings('tenant-1', { dashboard_preference: 'ACCOUNTING' }, 'OWNER'),
        ).resolves.toEqual({ dashboard_preference: 'ACCOUNTING' });

        await expect(
            service.updateDashboardSettings('tenant-1', { dashboard_preference: 'ACCOUNTING' }, 'MANAGER'),
        ).resolves.toEqual({ dashboard_preference: 'ACCOUNTING' });

        expect(db.tenant.update).toHaveBeenCalledTimes(2);
    });

    it('refuses roles that only consume the workspace', async () => {
        // The setting is workspace-wide, so a cashier or accountant flipping it
        // would change what every colleague sees.
        for (const role of ['CASHIER', 'ACCOUNTANT', undefined]) {
            await expect(
                service.updateDashboardSettings('tenant-1', { dashboard_preference: 'RETAIL' }, role),
            ).rejects.toThrow(ForbiddenException);
        }
        expect(db.tenant.update).not.toHaveBeenCalled();
    });

    it('is a no-op read when the body carries no preference', async () => {
        db.tenant.findUnique.mockResolvedValue({ dashboard_preference: 'RETAIL' });

        await expect(service.updateDashboardSettings('tenant-1', {}, 'OWNER')).resolves.toEqual({
            dashboard_preference: 'RETAIL',
        });
        expect(db.tenant.update).not.toHaveBeenCalled();
    });
});
