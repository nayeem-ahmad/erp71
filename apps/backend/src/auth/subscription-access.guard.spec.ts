import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionAccessGuard } from './subscription-access.guard';
import {
    SUBSCRIPTION_EXTRA_FEATURES_KEY,
    SUBSCRIPTION_FEATURE_KEY,
    SUBSCRIPTION_PLAN_KEY,
} from './subscription-access.decorator';

const makeContext = (overrides: Partial<{ userId: string; tenantId: string }> = {}) => {
    const req = {
        user: { userId: overrides.userId ?? 'user-1' },
        headers: { 'x-tenant-id': overrides.tenantId ?? 'tenant-1' },
    };
    return {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => ({}),
        getClass: () => ({}),
    } as any;
};

describe('SubscriptionAccessGuard', () => {
    let guard: SubscriptionAccessGuard;
    let reflector: jest.Mocked<Reflector>;
    const db = {
        tenantUser: { findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn() },
    };

    const metadataFor = (planCode?: string, feature?: string, extraFeatures: string[] = []) => {
        reflector.getAllAndOverride.mockImplementation((key: string) => {
            if (key === SUBSCRIPTION_PLAN_KEY) return planCode;
            if (key === SUBSCRIPTION_FEATURE_KEY) return feature;
            if (key === SUBSCRIPTION_EXTRA_FEATURES_KEY) return extraFeatures;
            return undefined;
        });
    };

    beforeEach(() => {
        jest.resetAllMocks();
        reflector = { getAllAndOverride: jest.fn() } as any;
        guard = new SubscriptionAccessGuard(reflector, db as any);
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantAddonSubscription.findMany.mockResolvedValue([]);
    });

    it('allows FREE-tier routes with no metadata to skip DB checks entirely', async () => {
        metadataFor(undefined, undefined, []);
        await expect(guard.canActivate(makeContext())).resolves.toBe(true);
        expect(db.tenantSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('blocks a plan-gated route when the tenant is on a lower plan', async () => {
        metadataFor('PREMIUM');
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'BASIC', features_json: {} },
        });
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('blocks a feature-gated route when neither the plan nor any add-on grants it', async () => {
        metadataFor(undefined, 'premiumManufacturing');
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('allows a feature-gated route when an active add-on grants the entitlement, even on the FREE plan', async () => {
        metadataFor(undefined, 'premiumManufacturing');
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        db.tenantAddonSubscription.findMany.mockResolvedValue([
            { addon: { features_json: { premiumManufacturing: true } } },
        ]);
        await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });

    it('does not let an add-on satisfy a plan-rank (@RequiresPlan) requirement', async () => {
        metadataFor('PREMIUM');
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        db.tenantAddonSubscription.findMany.mockResolvedValue([
            { addon: { features_json: { premiumManufacturing: true } } },
        ]);
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('blocks when the subscription is not ACTIVE/TRIALING', async () => {
        metadataFor(undefined, 'premiumManufacturing');
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'PAST_DUE',
            plan: { code: 'PREMIUM', features_json: { premiumManufacturing: true } },
        });
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('throws UnauthorizedException when tenant context is missing', async () => {
        metadataFor(undefined, 'premiumManufacturing');
        const ctx = makeContext();
        (ctx.switchToHttp().getRequest() as any).headers['x-tenant-id'] = undefined;
        await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
});
