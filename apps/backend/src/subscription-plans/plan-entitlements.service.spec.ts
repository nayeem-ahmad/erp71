import { ForbiddenException } from '@nestjs/common';
import { PlanEntitlementsService } from './plan-entitlements.service';

describe('PlanEntitlementsService', () => {
    const db = {
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn() },
        product: { count: jest.fn() },
        tenantUser: { count: jest.fn(), findMany: jest.fn() },
        userInvitation: { count: jest.fn() },
        store: { count: jest.fn() },
        employee: { findMany: jest.fn() },
        userStorePermission: { findMany: jest.fn() },
    };

    let service: PlanEntitlementsService;

    beforeEach(() => {
        jest.clearAllMocks();
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);
        db.employee.findMany.mockResolvedValue([]);
        db.userStorePermission.findMany.mockResolvedValue([]);
        db.tenantUser.findMany.mockResolvedValue([]);
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

    describe('portal-only members do not consume seats', () => {
        const planWithTwoSeats = {
            plan: { code: 'BASIC', features_json: { maxUsers: 2, maxSkus: 100, maxStores: 1 } },
        };

        it('excludes employees who hold portal access and no store permissions', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(planWithTwoSeats);
            // Two staff plus three people who can only read their own payslip.
            db.tenantUser.count.mockResolvedValue(5);
            db.userInvitation.count.mockResolvedValue(0);
            db.employee.findMany.mockResolvedValue([
                { user_id: 'u-3' }, { user_id: 'u-4' }, { user_id: 'u-5' },
            ]);
            db.userStorePermission.findMany.mockResolvedValue([]);
            db.tenantUser.findMany.mockResolvedValue([
                { user_id: 'u-3', role: 'CASHIER' },
                { user_id: 'u-4', role: 'CASHIER' },
                { user_id: 'u-5', role: 'CASHIER' },
            ]);

            // 5 members - 3 portal-only = 2 billable, which is the whole quota,
            // so a further invite is still refused...
            await expect(service.assertUserQuota('tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
            // ...but granting portal access to those three did not itself
            // consume the seats, which is the behaviour being fixed.
            await expect(service.assertUserQuota('tenant-1', 0)).resolves.toBeUndefined();
        });

        it('bills a portal user the moment they are given a store permission', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(planWithTwoSeats);
            db.tenantUser.count.mockResolvedValue(3);
            db.userInvitation.count.mockResolvedValue(0);
            db.employee.findMany.mockResolvedValue([{ user_id: 'u-3' }]);
            db.userStorePermission.findMany.mockResolvedValue([{ user_id: 'u-3' }]);
            db.tenantUser.findMany.mockResolvedValue([{ user_id: 'u-3', role: 'CASHIER' }]);

            // They are staff now, so all 3 count and the quota of 2 is blown.
            await expect(service.assertUserQuota('tenant-1', 0)).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('never treats an OWNER as portal-only', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(planWithTwoSeats);
            db.tenantUser.count.mockResolvedValue(3);
            db.userInvitation.count.mockResolvedValue(0);
            db.employee.findMany.mockResolvedValue([{ user_id: 'u-1' }]);
            db.userStorePermission.findMany.mockResolvedValue([]);
            db.tenantUser.findMany.mockResolvedValue([{ user_id: 'u-1', role: 'OWNER' }]);

            // An OWNER bypasses permission checks, so having no permission rows
            // does not make them a portal-only member.
            await expect(service.assertUserQuota('tenant-1', 0)).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('skips the lookup entirely when nobody has portal access', async () => {
            db.tenantSubscription.findUnique.mockResolvedValue(planWithTwoSeats);
            db.tenantUser.count.mockResolvedValue(1);
            db.userInvitation.count.mockResolvedValue(0);
            db.employee.findMany.mockResolvedValue([]);

            await expect(service.assertUserQuota('tenant-1')).resolves.toBeUndefined();
            expect(db.userStorePermission.findMany).not.toHaveBeenCalled();
        });
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