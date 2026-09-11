import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenantInterceptor } from './tenant.interceptor';
import { of } from 'rxjs';

const makeContext = (overrides: {
    userId?: string;
    tenantIdHeader?: string;
    storeIdHeader?: string;
}) => {
    const req: any = {
        user: overrides.userId ? { userId: overrides.userId } : undefined,
        headers: {
            'x-tenant-id': overrides.tenantIdHeader,
            'x-store-id': overrides.storeIdHeader,
        },
    };
    const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
    } as any;
    return { ctx, req };
};

const next = { handle: () => of('ok') } as any;

const timezones = {
    for: jest.fn(async () => 'Asia/Dhaka'),
    forMany: jest.fn(async () => new Map()),
    prime: jest.fn(),
    invalidate: jest.fn(),
};

describe('TenantInterceptor', () => {
    let db: any;
    let interceptor: TenantInterceptor;

    beforeEach(() => {
        db = {
            tenantUser: { findFirst: jest.fn(), findMany: jest.fn() },
            userStoreAccess: { findUnique: jest.fn(), findMany: jest.fn() },
        };
        interceptor = new TenantInterceptor(db, timezones as any);
        jest.resetAllMocks();
    });

    it('skips auth when userId is missing', async () => {
        const { ctx, req } = makeContext({ tenantIdHeader: 'tenant-1' });
        req.user = undefined;
        await interceptor.intercept(ctx, next);
        expect(req.tenantId).toBeUndefined();
    });

    it('sets tenantId and userRole from header', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 'tenant-1', role: 'MANAGER' });
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await interceptor.intercept(ctx, next);
        expect(req.tenantId).toBe('tenant-1');
        expect(req.userRole).toBe('MANAGER');
    });

    it('throws ForbiddenException for a tenant the user is not a member of', async () => {
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'bad-tenant' });
        db.tenantUser.findFirst.mockResolvedValue(null);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
    });

    it('auto-resolves tenant when user has exactly one', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1' });
        db.tenantUser.findMany.mockResolvedValue([{ tenant_id: 'tenant-1', role: 'OWNER' }]);
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await interceptor.intercept(ctx, next);
        expect(req.tenantId).toBe('tenant-1');
    });

    it('throws BadRequestException when user has multiple tenants and no header', async () => {
        const { ctx } = makeContext({ userId: 'user-1' });
        db.tenantUser.findMany.mockResolvedValue([
            { tenant_id: 'tenant-1', role: 'OWNER' },
            { tenant_id: 'tenant-2', role: 'MANAGER' },
        ]);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(BadRequestException);
    });

    it('validates store access for non-OWNER', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'store-1' });
        db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 'tenant-1', role: 'CASHIER' });
        db.userStoreAccess.findUnique.mockResolvedValue({ store_id: 'store-1', access_level: 'STORE_ONLY' });
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('store-1');
    });

    it('throws ForbiddenException when non-OWNER accesses unauthorized store', async () => {
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'store-forbidden' });
        db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 'tenant-1', role: 'CASHIER' });
        db.userStoreAccess.findUnique.mockResolvedValue(null);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
    });

    it('bypasses store access check for OWNER', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'any-store' });
        db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 'tenant-1', role: 'OWNER' });
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('any-store');
        expect(db.userStoreAccess.findUnique).not.toHaveBeenCalled();
    });

    it('auto-resolves storeId when user has exactly one store access', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 'tenant-1', role: 'CASHIER' });
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1' }]);
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('store-1');
    });
    /**
     * Record scope rides the membership lookup, and is resolved widest-wins:
     * one unrestricted role makes the member wide, so being given a second role
     * widens them rather than leaving them narrowed.
     */
    describe('record scope', () => {
        const withRoles = (role: string, scopes: string[]) => ({
            tenant_id: 'tenant-1',
            role,
            roles: scopes.map((record_scope) => ({ tenantRole: { record_scope } })),
        });

        it('is OWN when every role the member holds says so', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.tenantUser.findFirst.mockResolvedValue(withRoles('CASHIER', ['OWN', 'OWN']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('OWN');
        });

        it('is ALL as soon as one role is unrestricted', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.tenantUser.findFirst.mockResolvedValue(withRoles('CASHIER', ['OWN', 'ALL']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('is ALL for a member holding no roles at all', async () => {
            // They hold no permissions either, so there is nothing to narrow —
            // and treating "not set up yet" as the strictest setting would make
            // it the silent default.
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.tenantUser.findFirst.mockResolvedValue(withRoles('CASHIER', []));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('is ALL for the workspace owner whatever their roles say', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.tenantUser.findFirst.mockResolvedValue(withRoles('OWNER', ['OWN']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('resolves it on the single-workspace path too, where no header is sent', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1' });
            db.tenantUser.findMany.mockResolvedValue([withRoles('CASHIER', ['OWN'])]);
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('OWN');
        });
    });
});
