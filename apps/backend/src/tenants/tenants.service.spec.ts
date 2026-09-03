import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

describe('TenantsService', () => {
    let service: TenantsService;

    const db = {
        tenant: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    const planEntitlements = {
        assertEntitlement: jest.fn(),
    };

    const timezones = {
        for: jest.fn(async () => 'Asia/Dhaka'),
        forMany: jest.fn(async () => new Map()),
        prime: jest.fn(),
        invalidate: jest.fn(),
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantsService,
                { provide: DatabaseService, useValue: db },
                { provide: TenantTimezoneService, useValue: timezones },
                { provide: PlanEntitlementsService, useValue: planEntitlements },
            ],
        }).compile();

        service = module.get(TenantsService);
    });

    describe('storefront enable gate', () => {
        it('requires premiumStorefront to switch the storefront on', async () => {
            db.tenant.findUnique.mockResolvedValue({ storefront_enabled: false });
            db.tenant.update.mockResolvedValue({});

            await service.updateStorefrontSettings('tenant-1', { storefront_enabled: true } as never);

            expect(planEntitlements.assertEntitlement).toHaveBeenCalledWith('tenant-1', 'premiumStorefront');
        });

        it('leaves a tenant whose storefront is already live alone', async () => {
            // Grandfathering: the storefront shipped ungated, so enforcing it now
            // must not take a live public shop offline.
            db.tenant.findUnique.mockResolvedValue({ storefront_enabled: true });
            db.tenant.update.mockResolvedValue({});

            await service.updateStorefrontSettings('tenant-1', { storefront_enabled: true } as never);

            expect(planEntitlements.assertEntitlement).not.toHaveBeenCalled();
        });

        it('always allows switching the storefront off', async () => {
            db.tenant.update.mockResolvedValue({});

            await service.updateStorefrontSettings('tenant-1', { storefront_enabled: false } as never);

            expect(planEntitlements.assertEntitlement).not.toHaveBeenCalled();
        });

        it('does not gate edits that leave the enabled flag alone', async () => {
            db.tenant.update.mockResolvedValue({});

            await service.updateStorefrontSettings('tenant-1', { storefront_banner: 'x.png' } as never);

            expect(planEntitlements.assertEntitlement).not.toHaveBeenCalled();
        });
    });

    it('returns tenant localization settings', async () => {
        db.tenant.findUnique.mockResolvedValue({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });

        const result = await service.getLocalizationSettings('tenant-1');

        expect(db.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
                timezone: true,
            },
        });
        expect(result).toEqual({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });
    });

    it('updates tenant localization settings when enabled', async () => {
        db.tenant.findUnique.mockResolvedValue({
            localization_enabled: true,
            secondary_locale: 'bn',
        });
        db.tenant.update.mockResolvedValue({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });

        const result = await service.updateLocalizationSettings('tenant-1', { default_locale: 'bn' });

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            data: { default_locale: 'bn' },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
                timezone: true,
            },
        });
        expect(result).toEqual({
            default_locale: 'bn',
            localization_enabled: true,
            secondary_locale: 'bn',
        });
    });

    it('rejects tenant localization updates when switching is disabled', async () => {
        db.tenant.findUnique.mockResolvedValue({
            localization_enabled: false,
            secondary_locale: null,
        });

        await expect(
            service.updateLocalizationSettings('tenant-1', { default_locale: 'bn' }),
        ).rejects.toThrow(BadRequestException);
        expect(db.tenant.update).not.toHaveBeenCalled();
    });

    it('stores an IANA timezone and drops the cached one so the change takes effect at once', async () => {
        db.tenant.findUnique.mockResolvedValue({ localization_enabled: false, secondary_locale: null });
        db.tenant.update.mockResolvedValue({ timezone: 'America/New_York' });

        await service.updateLocalizationSettings('tenant-1', { timezone: 'America/New_York' } as any);

        expect(db.tenant.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { timezone: 'America/New_York' } }),
        );
        expect(timezones.invalidate).toHaveBeenCalledWith('tenant-1');
    });

    it('sets the timezone even when the language switcher is disabled', async () => {
        // Every workspace has a working day; only the second language is gated.
        db.tenant.findUnique.mockResolvedValue({ localization_enabled: false, secondary_locale: null });
        db.tenant.update.mockResolvedValue({ timezone: 'Asia/Kolkata' });

        await expect(
            service.updateLocalizationSettings('tenant-1', { timezone: 'Asia/Kolkata' } as any),
        ).resolves.toBeDefined();
    });

    it('rejects a bare offset, which cannot express DST', async () => {
        db.tenant.findUnique.mockResolvedValue({ localization_enabled: true, secondary_locale: 'bn' });

        await expect(
            service.updateLocalizationSettings('tenant-1', { timezone: '+06:00' } as any),
        ).rejects.toThrow(/IANA/);
        expect(db.tenant.update).not.toHaveBeenCalled();
    });

    it('rejects a zone the runtime does not know', async () => {
        db.tenant.findUnique.mockResolvedValue({ localization_enabled: true, secondary_locale: 'bn' });

        await expect(
            service.updateLocalizationSettings('tenant-1', { timezone: 'Mars/Olympus' } as any),
        ).rejects.toThrow(/IANA/);
        expect(db.tenant.update).not.toHaveBeenCalled();
    });
});