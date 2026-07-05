import { ForbiddenException } from '@nestjs/common';
import { PlanEntitlementsService } from './plan-entitlements.service';

describe('PlanEntitlementsService', () => {
    const db = {
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn() },
        product: { count: jest.fn() },
        tenantUser: { count: jest.fn() },
        userInvitation: { count: jest.fn() },
        store: { count: jest.fn() },
    };

    let service: PlanEntitlementsService;

    beforeEach(() => {
        jest.clearAllMocks();
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);
        service = new PlanEntitlementsService(db as any);
    });

    it('blocks product creation when SKU quota is exceeded', async () => {
        db.tenantSubscription.findUnique.mockResolvedValue({
            plan: {
                code: 'FREE',
                features_json: { maxSkus: 2, maxUsers: 5, maxStores: 1 },
            },
        });
        db.product.count.mockResolvedValue(2);

        await expect(service.assertProductQuota('tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows unlimited products when maxSkus is -1', async () => {
        db.tenantSubscription.findUnique.mockResolvedValue({
            plan: {
                code: 'PREMIUM',
                features_json: { maxSkus: -1, maxUsers: 30, maxStores: 10 },
            },
        });
        db.product.count.mockResolvedValue(99_999);

        await expect(service.assertProductQuota('tenant-1')).resolves.toBeUndefined();
    });

    it('blocks invites when user quota is exceeded', async () => {
        db.tenantSubscription.findUnique.mockResolvedValue({
            plan: {
                code: 'FREE',
                features_json: { maxUsers: 2, maxSkus: 100, maxStores: 1 },
            },
        });
        db.tenantUser.count.mockResolvedValue(1);
        db.userInvitation.count.mockResolvedValue(1);

        await expect(service.assertUserQuota('tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('grants an entitlement from an active add-on that the FREE plan lacks', async () => {
        db.tenantSubscription.findUnique.mockResolvedValue({
            plan: { code: 'FREE', features_json: {} },
        });
        db.tenantAddonSubscription.findMany.mockResolvedValue([
            { addon: { features_json: { premiumManufacturing: true } } },
        ]);

        const features = await service.getFeaturesForTenant('tenant-1');
        expect(features.premiumManufacturing).toBe(true);
    });

    it('only queries active/trialing, non-expired add-ons', async () => {
        db.tenantSubscription.findUnique.mockResolvedValue({
            plan: { code: 'FREE', features_json: {} },
        });
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);

        await service.getFeaturesForTenant('tenant-1');

        expect(db.tenantAddonSubscription.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    status: { in: ['ACTIVE', 'TRIALING'] },
                    current_period_end: expect.objectContaining({ gt: expect.any(Date) }),
                }),
            }),
        );
    });
});