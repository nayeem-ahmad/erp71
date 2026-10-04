import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenantInterceptor } from './tenant.interceptor';
import { loadTenantMembership } from './tenant-membership.loader';
import { AuthCacheService } from './auth-cache.service';
import { of } from 'rxjs';

/** The cross-request cache switched off, so each case sees one request's queries. */
const noCache = () => new AuthCacheService({ ttlMs: 0 });

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

/**
 * The single row the membership loader's joined query returns. The loader reads
 * it with one `$queryRaw` rather than a nested Prisma `select`, which Prisma
 * would have split into four queries — see tenant-membership.loader.ts.
 */
const membershipRows = (
    row: {
        role: string;
        scopes?: string[];
        names?: string[];
        deletedAt?: Date | null;
        timezone?: string | null;
    } | null,
) =>
    row === null
        ? []
        : [
              {
                  tenant_id: 'tenant-1',
                  user_id: 'user-1',
                  role: row.role,
                  tenant_deleted_at: row.deletedAt ?? null,
                  tenant_timezone: row.timezone ?? null,
                  roles: (row.scopes ?? []).map((record_scope, i) => ({
                      name: row.names?.[i] ?? `Role ${i + 1}`,
                      record_scope,
                  })),
              },
          ];

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
            $queryRaw: jest.fn(),
            tenantUser: { findMany: jest.fn() },
            userStoreAccess: { findUnique: jest.fn(), findMany: jest.fn() },
            store: { findFirst: jest.fn() },
        };
        interceptor = new TenantInterceptor(db, timezones as any, noCache());
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
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'MANAGER' }));
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await interceptor.intercept(ctx, next);
        expect(req.tenantId).toBe('tenant-1');
        expect(req.userRole).toBe('MANAGER');
    });

    it('throws ForbiddenException for a tenant the user is not a member of', async () => {
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'bad-tenant' });
        db.$queryRaw.mockResolvedValue(membershipRows(null));
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
    });

    it('treats a member of a soft-deleted tenant as no member at all', async () => {
        // The membership read no longer filters on `tenant.deleted_at` — the row
        // is shared with the guards, which do not filter it — so the check moved
        // here. A deleted workspace must still be refused.
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'MANAGER', deletedAt: new Date(), timezone: 'Asia/Dhaka' }));
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
    });

    it('reads the membership once per request even when a guard already loaded it', async () => {
        // Guards run before interceptors and read the same row. The loader caches
        // it on the request, so the second reader must not issue a second query.
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'MANAGER' }));
        db.userStoreAccess.findMany.mockResolvedValue([]);

        await loadTenantMembership(db, req, 'tenant-1', 'user-1', noCache());
        await interceptor.intercept(ctx, next);

        expect(db.$queryRaw).toHaveBeenCalledTimes(1);
        expect(req.userRole).toBe('MANAGER');
    });

    it('does not cache a failed membership read', async () => {
        // A rejection must not be remembered, or the next reader on the same
        // request inherits it instead of getting its own attempt.
        const { req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.$queryRaw.mockRejectedValueOnce(new Error('connection lost'));
        await expect(loadTenantMembership(db, req, 'tenant-1', 'user-1', noCache())).rejects.toThrow(
            'connection lost',
        );

        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'MANAGER' }));
        await expect(loadTenantMembership(db, req, 'tenant-1', 'user-1', noCache())).resolves.toMatchObject({
            role: 'MANAGER',
        });
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
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1', access_level: 'STORE_ONLY' }]);
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('store-1');
    });

    it('throws ForbiddenException when non-OWNER accesses unauthorized store', async () => {
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'store-forbidden' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1', access_level: 'STORE_ONLY' }]);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
    });

    it('bypasses the per-user store access list for OWNER, but not the workspace check', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'store-a' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'OWNER' }));
        db.store.findFirst.mockResolvedValue({ id: 'store-a' });
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('store-a');
        expect(db.userStoreAccess.findMany).not.toHaveBeenCalled();
        expect(db.store.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'store-a', tenant_id: 'tenant-1' } }),
        );
    });

    it('refuses an OWNER a store that belongs to another workspace', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', storeIdHeader: 'store-of-b' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'OWNER' }));
        db.store.findFirst.mockResolvedValue(null);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
        expect(req.storeId).toBeUndefined();
    });

    // A member can own a workspace, and with it a store carrying every permission.
    // Access to *that* store must not count as access to a store in the workspace
    // named in the header.
    it('looks store access up for the workspace being accessed', async () => {
        const { ctx } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-victim', storeIdHeader: 'store-mine' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
        // What the database answers: their own store is not on their access list
        // for the victim's workspace.
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await expect(interceptor.intercept(ctx, next)).rejects.toThrow(ForbiddenException);
        expect(db.userStoreAccess.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { user_id: 'user-1', tenant_id: 'tenant-victim' },
            }),
        );
    });

    it('auto-resolves storeId when user has exactly one store access', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1' }]);
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBe('store-1');
    });

    it('leaves the store unresolved when the member can reach several', async () => {
        const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
        db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1' }, { store_id: 'store-2' }]);
        await interceptor.intercept(ctx, next);
        expect(req.storeId).toBeUndefined();
    });

    /**
     * Across requests the membership, the access list and the owner's store
     * check come from `AuthCacheService`. Each case below pairs the cached path
     * with the write that has to break it: the next request after that write's
     * invalidation must see the new answer, not the cached one.
     */
    describe('with the cross-request cache on', () => {
        let cache: AuthCacheService;
        let cached: TenantInterceptor;

        beforeEach(() => {
            cache = new AuthCacheService({ ttlMs: 30_000 });
            cached = new TenantInterceptor(db, timezones as any, cache);
        });

        const run = async (headers: { storeIdHeader?: string } = {}) => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1', ...headers });
            await cached.intercept(ctx, next);
            return req;
        };

        it('answers a second request from memory: no membership, access or store query', async () => {
            db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
            db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1', access_level: 'STORE_ONLY' }]);

            await run({ storeIdHeader: 'store-1' });
            const second = await run({ storeIdHeader: 'store-1' });

            expect(second.storeId).toBe('store-1');
            expect(db.$queryRaw).toHaveBeenCalledTimes(1);
            expect(db.userStoreAccess.findMany).toHaveBeenCalledTimes(1);
        });

        it("caches an owner's store check too", async () => {
            db.$queryRaw.mockResolvedValue(membershipRows({ role: 'OWNER' }));
            db.store.findFirst.mockResolvedValue({ id: 'store-a' });

            await run({ storeIdHeader: 'store-a' });
            await run({ storeIdHeader: 'store-a' });

            expect(db.store.findFirst).toHaveBeenCalledTimes(1);
        });

        it('refuses a revoked branch on the next request once the revoke invalidates', async () => {
            db.$queryRaw.mockResolvedValue(membershipRows({ role: 'CASHIER' }));
            db.userStoreAccess.findMany.mockResolvedValueOnce([{ store_id: 'store-1', access_level: 'STORE_ONLY' }]);
            await run({ storeIdHeader: 'store-1' });

            db.userStoreAccess.findMany.mockResolvedValueOnce([]);
            cache.invalidateMember('user-1', 'tenant-1');

            await expect(run({ storeIdHeader: 'store-1' })).rejects.toThrow(ForbiddenException);
        });

        it('refuses a deleted workspace on the next request once the delete invalidates', async () => {
            db.$queryRaw.mockResolvedValueOnce(membershipRows({ role: 'OWNER' }));
            db.userStoreAccess.findMany.mockResolvedValue([]);
            await run();

            db.$queryRaw.mockResolvedValueOnce(membershipRows({ role: 'OWNER', deletedAt: new Date() }));
            cache.invalidateTenant('tenant-1');

            await expect(run()).rejects.toThrow('Invalid tenant context');
        });

        // The interceptor primes `TenantTimezoneService` from the membership on
        // every request, so a cached membership holding the old zone would put it
        // straight back after `TenantsService` cleared it.
        it('carries a changed timezone on the next request once the change invalidates', async () => {
            db.$queryRaw.mockResolvedValueOnce(membershipRows({ role: 'OWNER', timezone: 'Asia/Dhaka' }));
            db.userStoreAccess.findMany.mockResolvedValue([]);
            expect((await run()).timezone).toBe('Asia/Dhaka');

            db.$queryRaw.mockResolvedValueOnce(membershipRows({ role: 'OWNER', timezone: 'Asia/Kolkata' }));
            cache.invalidateTenant('tenant-1');

            expect((await run()).timezone).toBe('Asia/Kolkata');
            expect(timezones.prime).toHaveBeenLastCalledWith('tenant-1', 'Asia/Kolkata');
        });
    });

    /**
     * Record scope rides the membership lookup, and is resolved widest-wins:
     * one unrestricted role makes the member wide, so being given a second role
     * widens them rather than leaving them narrowed.
     */
    describe('record scope', () => {
        const withRoles = (role: string, scopes: string[]) => membershipRows({ role, scopes });
        // The no-header path still reads through Prisma, so it needs that shape.
        const withRolesPrisma = (role: string, scopes: string[]) => ({
            tenant_id: 'tenant-1',
            role,
            roles: scopes.map((record_scope) => ({ tenantRole: { record_scope } })),
        });

        it('is OWN when every role the member holds says so', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.$queryRaw.mockResolvedValue(withRoles('CASHIER', ['OWN', 'OWN']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('OWN');
        });

        it('is ALL as soon as one role is unrestricted', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.$queryRaw.mockResolvedValue(withRoles('CASHIER', ['OWN', 'ALL']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('is ALL for a member holding no roles at all', async () => {
            // They hold no permissions either, so there is nothing to narrow —
            // and treating "not set up yet" as the strictest setting would make
            // it the silent default.
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.$queryRaw.mockResolvedValue(withRoles('CASHIER', []));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('is ALL for the workspace owner whatever their roles say', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1', tenantIdHeader: 'tenant-1' });
            db.$queryRaw.mockResolvedValue(withRoles('OWNER', ['OWN']));
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('ALL');
        });

        it('resolves it on the single-workspace path too, where no header is sent', async () => {
            const { ctx, req } = makeContext({ userId: 'user-1' });
            db.tenantUser.findMany.mockResolvedValue([withRolesPrisma('CASHIER', ['OWN'])]);
            db.userStoreAccess.findMany.mockResolvedValue([]);

            await interceptor.intercept(ctx, next);

            expect(req.recordScope).toBe('OWN');
        });
    });
});
