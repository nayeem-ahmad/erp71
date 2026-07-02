import { ForbiddenException } from '@nestjs/common';
import { PlanEntitlementsService } from './plan-entitlements.service';

describe('PlanEntitlementsService', () => {
    const db = {
        tenantSubscription: { findUnique: jest.fn() },
        product: { count: jest.fn() },
        tenantUser: { count: jest.fn() },
        userInvitation: { count: jest.fn() },
        store: { count: jest.fn() },
    };

    let service: PlanEntitlementsService;

    beforeEach(() => {
        jest.clearAllMocks();
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
});