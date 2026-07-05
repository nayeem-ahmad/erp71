import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { defaultPlanFeatures } from '@erp71/shared-types';
import { AddonModulesService } from './addon-modules.service';

describe('AddonModulesService', () => {
    const db = {
        addonModule: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        tenantAddonSubscription: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
        },
    };
    const audit = { log: jest.fn() };

    let service: AddonModulesService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AddonModulesService(db as any, audit as any);
    });

    const baseAddon = {
        id: 'addon-1',
        code: 'MANUFACTURING',
        name: 'Manufacturing',
        description: 'BOM and production jobs',
        category: 'operations',
        monthly_price: 999,
        yearly_price: 9990,
        is_active: true,
        sort_order: 1,
        features_json: { ...defaultPlanFeatures(), premiumManufacturing: true },
        _count: { subscriptions: 3 },
    };

    it('lists the active catalog for tenants, filtered to is_active', async () => {
        db.addonModule.findMany.mockResolvedValue([baseAddon]);

        const result = await service.listCatalogForTenants();

        expect(db.addonModule.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { is_active: true } }),
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ code: 'MANUFACTURING', monthly_price: 999 });
        expect(result[0].features_json.premiumManufacturing).toBe(true);
    });

    it('rejects creating an add-on with a duplicate code', async () => {
        db.addonModule.findUnique.mockResolvedValue(baseAddon);

        await expect(
            service.createAddon(
                {
                    code: 'manufacturing',
                    name: 'Manufacturing',
                    monthly_price: 999,
                    features: defaultPlanFeatures() as any,
                },
                'admin-1',
            ),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates an add-on and writes an audit log', async () => {
        db.addonModule.findUnique.mockResolvedValue(null);
        db.addonModule.create.mockResolvedValue(baseAddon);

        const result = await service.createAddon(
            {
                code: 'manufacturing',
                name: 'Manufacturing',
                monthly_price: 999,
                features: { ...defaultPlanFeatures(), premiumManufacturing: true } as any,
            },
            'admin-1',
        );

        expect(db.addonModule.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ code: 'MANUFACTURING' }) }),
        );
        expect(result.code).toBe('MANUFACTURING');
        expect(audit.log).toHaveBeenCalled();
    });

    it('returns only active, unexpired add-on subscriptions for a tenant', async () => {
        db.tenantAddonSubscription.findMany.mockResolvedValue([
            {
                addon: baseAddon,
                status: 'ACTIVE',
                current_period_start: new Date('2026-01-01'),
                current_period_end: new Date('2026-02-01'),
                cancel_at_period_end: false,
            },
        ]);

        const result = await service.getActiveForTenant('tenant-1');

        expect(db.tenantAddonSubscription.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    status: { in: ['ACTIVE', 'TRIALING'] },
                }),
            }),
        );
        expect(result).toHaveLength(1);
        expect(result[0].addon.code).toBe('MANUFACTURING');
    });

    it('throws when trying to purchase an unknown or inactive add-on code', async () => {
        db.addonModule.findUnique.mockResolvedValue(null);
        await expect(service.findActiveByCodeOrThrow('DOES_NOT_EXIST')).rejects.toBeInstanceOf(BadRequestException);

        db.addonModule.findUnique.mockResolvedValue({ ...baseAddon, is_active: false });
        await expect(service.findActiveByCodeOrThrow('MANUFACTURING')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when cancelling an add-on the tenant never purchased', async () => {
        db.addonModule.findUnique.mockResolvedValue(baseAddon);
        db.tenantAddonSubscription.findUnique.mockResolvedValue(null);

        await expect(service.cancelAddonAtPeriodEnd('tenant-1', 'MANUFACTURING')).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('grants a new add-on subscription via upsert', async () => {
        db.tenantAddonSubscription.upsert.mockResolvedValue({});
        const periodStart = new Date('2026-01-01');
        const periodEnd = new Date('2026-02-01');

        await service.grantOrRenewSubscription({
            tenantId: 'tenant-1',
            addonId: 'addon-1',
            status: 'ACTIVE',
            periodStart,
            periodEnd,
            providerName: 'manual',
            providerSubscriptionRef: 'ref-1',
        });

        expect(db.tenantAddonSubscription.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id_addon_id: { tenant_id: 'tenant-1', addon_id: 'addon-1' } },
            }),
        );
    });
});
