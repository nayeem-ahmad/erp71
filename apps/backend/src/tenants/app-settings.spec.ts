import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

describe('TenantsService — app settings', () => {
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
                { provide: AuthCacheService, useValue: new AuthCacheService({ ttlMs: 0 }) },
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

    it('returns the hidden apps, keeping only ones the registry still knows', async () => {
        db.tenant.findUnique.mockResolvedValue({ hidden_apps: ['crm', 'retired-module'] });
        await expect(service.getAppSettings('tenant-1')).resolves.toEqual({ hidden_apps: ['crm'] });
    });

    it('returns nothing hidden for a workspace that never set it', async () => {
        db.tenant.findUnique.mockResolvedValue({ hidden_apps: [] });
        await expect(service.getAppSettings('tenant-1')).resolves.toEqual({ hidden_apps: [] });
    });

    it('rejects an unknown tenant', async () => {
        db.tenant.findUnique.mockResolvedValue(null);
        await expect(service.getAppSettings('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('lets an owner or manager hide apps, storing each once', async () => {
        db.tenant.update.mockImplementation(async ({ data }) => ({ hidden_apps: data.hidden_apps }));

        await expect(
            service.updateAppSettings('tenant-1', { hidden_apps: ['crm', 'crm', 'hr'] }, 'OWNER'),
        ).resolves.toEqual({ hidden_apps: ['crm', 'hr'] });
        await expect(
            service.updateAppSettings('tenant-1', { hidden_apps: [] }, 'MANAGER'),
        ).resolves.toEqual({ hidden_apps: [] });

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: { hidden_apps: ['crm', 'hr'] },
            select: { hidden_apps: true },
        });
    });

    it('refuses roles that only consume the workspace', async () => {
        for (const role of ['CASHIER', 'ACCOUNTANT', undefined]) {
            await expect(
                service.updateAppSettings('tenant-1', { hidden_apps: ['crm'] }, role),
            ).rejects.toThrow(ForbiddenException);
        }
        expect(db.tenant.update).not.toHaveBeenCalled();
    });

    it('refuses ids that are not business apps', async () => {
        // A utility (chat, settings) cannot be hidden, and a typo must not be
        // stored as if it meant something.
        for (const hidden of [['crm', 'nope'], ['chat'], ['account-settings']]) {
            await expect(
                service.updateAppSettings('tenant-1', { hidden_apps: hidden }, 'OWNER'),
            ).rejects.toThrow(BadRequestException);
        }
        expect(db.tenant.update).not.toHaveBeenCalled();
    });
});
