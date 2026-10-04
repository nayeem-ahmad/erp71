import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorePermissionGuard } from './store-permission.guard';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_ANY_KEY, STORE_PERMISSIONS_KEY } from './store-permission.decorator';
import { AuthCacheService } from '../database/auth-cache.service';

/** Grant rows as the loader reads them: every permission the member holds, by store. */
const grantRows = (permissions: StorePermission[], storeId = 'store-1') =>
    permissions.map((permission) => ({ store_id: storeId, permission }));

/** The cache switched off, so each test sees exactly the queries one request makes. */
const noCache = () => new AuthCacheService({ ttlMs: 0 });

const makeContext = (overrides: Partial<{
    userId: string;
    storeId: string;
    tenantId: string;
    userRole: string;
    /** Leaves `request.userRole` unset, as a real request has it before TenantInterceptor runs. */
    noPresetRole: boolean;
}> = {}) => {
    const req: any = {
        user: { userId: overrides.userId ?? 'user-1' },
        storeId: overrides.storeId ?? 'store-1',
        tenantId: overrides.tenantId ?? 'tenant-1',
        userRole: overrides.noPresetRole ? undefined : overrides.userRole ?? 'CASHIER',
        headers: {
            'x-tenant-id': overrides.tenantId ?? 'tenant-1',
            'x-store-id': overrides.storeId ?? 'store-1',
        },
    };
    return {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => ({}),
        getClass: () => ({}),
    } as any;
};

describe('StorePermissionGuard', () => {
    let guard: StorePermissionGuard;
    let reflector: jest.Mocked<Reflector>;
    const db = {
        userStorePermission: {
            findMany: jest.fn(),
        },
        // The membership is read through the shared loader's joined query.
        $queryRaw: jest.fn(),
        userStoreAccess: {
            findMany: jest.fn(),
        },
    };

    beforeEach(() => {
        reflector = { getAllAndOverride: jest.fn() } as any;
        guard = new StorePermissionGuard(reflector, db as any, noCache());
        jest.resetAllMocks();
    });

    it('allows when no permissions are required', async () => {
        reflector.getAllAndOverride.mockReturnValue(undefined);
        await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });

    /**
     * Guards run before `TenantInterceptor`, so on a real request `userRole` is
     * not yet on the request and this guard resolves the membership itself —
     * the branch every one of the 40 controllers behind it actually takes.
     */
    describe('when the request carries no resolved role yet', () => {
        const membershipRows = (role: string) => [
            {
                tenant_id: 'tenant-1',
                user_id: 'user-1',
                role,
                tenant_deleted_at: null,
                tenant_timezone: null,
                roles: [],
            },
        ];

        it('resolves the role from the membership and enforces the permission', async () => {
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
            db.$queryRaw.mockResolvedValue(membershipRows('CASHIER'));
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));

            const ctx = makeContext({ noPresetRole: true });
            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(ctx.switchToHttp().getRequest().userRole).toBe('CASHIER');
        });

        it('lets an OWNER resolved this way bypass the permission check', async () => {
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
            db.$queryRaw.mockResolvedValue(membershipRows('OWNER'));

            await expect(guard.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);
            expect(db.userStorePermission.findMany).not.toHaveBeenCalled();
        });

        it('reads the membership once when the loader already has it', async () => {
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
            db.$queryRaw.mockResolvedValue(membershipRows('OWNER'));

            const ctx = makeContext({ noPresetRole: true });
            await guard.canActivate(ctx);
            // Same request object: a second guard on it must not re-query.
            const second = new StorePermissionGuard(reflector, db as any, noCache());
            await second.canActivate(ctx);
            expect(db.$queryRaw).toHaveBeenCalledTimes(1);
        });
    });

    it('allows OWNER regardless of permissions', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        const ctx = makeContext({ userRole: 'OWNER' });
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(db.userStorePermission.findMany).not.toHaveBeenCalled();
    });

    it('allows when user has all required permissions', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));
        await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });

    it('throws ForbiddenException when permission is missing', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE, StorePermission.EDIT_PRODUCTS]);
        // EDIT_PRODUCTS not granted
        db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    // The grants are read for the whole workspace and picked by store here, so a
    // permission held at another branch must not count at this one.
    it('counts only the permissions held at the store the request names', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE], 'store-2'));

        await expect(guard.canActivate(makeContext({ storeId: 'store-1' }))).rejects.toThrow(ForbiddenException);
    });

    it('uses the sole branch a member can reach when the request names none', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        const ctx = makeContext();
        const req = ctx.switchToHttp().getRequest() as any;
        req.storeId = undefined;
        req.headers['x-store-id'] = undefined;
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-9', access_level: 'STORE_ONLY' }]);
        db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE], 'store-9'));

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(req.storeId).toBe('store-9');
    });

    it('throws BadRequestException when store context is missing (non-OWNER)', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        const ctx = makeContext({ storeId: undefined as any });
        const req = ctx.switchToHttp().getRequest() as any;
        req.storeId = undefined;
        req.headers['x-store-id'] = undefined;
        db.userStoreAccess.findMany.mockResolvedValue([]);
        await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when userId is missing', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        const ctx = makeContext();
        (ctx.switchToHttp().getRequest() as any).user = undefined;
        await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    // A store id arrives in a request header, and a member can own a workspace
    // (and a store with every permission) of their own. Permissions must be read
    // for the workspace being accessed, or a low-privilege member of workspace A
    // could send their own store's id and pass every check in A.
    describe('workspace scoping', () => {
        it('reads permissions for the workspace being accessed, not just the store', async () => {
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE], 'store-mine'));

            await guard.canActivate(makeContext({ tenantId: 'tenant-victim', storeId: 'store-mine' }));

            expect(db.userStorePermission.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { user_id: 'user-1', tenant_id: 'tenant-victim' },
                }),
            );
        });

        it('refuses a store whose grants belong to another workspace', async () => {
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
            // What the database now answers: no grant rows carry the victim's tenant id.
            db.userStorePermission.findMany.mockResolvedValue([]);

            await expect(
                guard.canActivate(makeContext({ tenantId: 'tenant-victim', storeId: 'store-mine' })),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    // "Any one of" — most routes are legitimately used by several roles (a sale is
    // read by whoever makes sales, orders, quotes or returns), so a route can
    // require one permission out of a set instead of all of a list.
    describe('any-of requirement', () => {
        const requireKeys = (all?: StorePermission[], any?: StorePermission[]) =>
            reflector.getAllAndOverride.mockImplementation(((key: string) =>
                key === STORE_PERMISSIONS_KEY ? all : key === STORE_PERMISSIONS_ANY_KEY ? any : undefined) as any);

        it('allows when the member holds one of the listed permissions', async () => {
            requireKeys(undefined, [StorePermission.CREATE_SALE, StorePermission.CREATE_QUOTATION]);
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_QUOTATION]));

            await expect(guard.canActivate(makeContext())).resolves.toBe(true);
        });

        it('refuses when the member holds none of them', async () => {
            requireKeys(undefined, [StorePermission.CREATE_SALE, StorePermission.CREATE_QUOTATION]);
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.VIEW_PROJECTS]));

            await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
        });

        it('names what would have been enough, so a 403 is diagnosable', async () => {
            requireKeys(undefined, [StorePermission.CREATE_SALE, StorePermission.CREATE_QUOTATION]);
            db.userStorePermission.findMany.mockResolvedValue([]);

            await expect(guard.canActivate(makeContext())).rejects.toThrow(/CREATE_SALE, CREATE_QUOTATION/);
        });

        it('lets OWNER through without a lookup', async () => {
            requireKeys(undefined, [StorePermission.CREATE_SALE]);

            await expect(guard.canActivate(makeContext({ userRole: 'OWNER' }))).resolves.toBe(true);
            expect(db.userStorePermission.findMany).not.toHaveBeenCalled();
        });

        it('requires the all-of list AND the any-of set when a route declares both', async () => {
            requireKeys([StorePermission.VIEW_LEDGER], [StorePermission.CREATE_SALE]);
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));

            await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
        });

        it('reads the grants once, for the workspace, for both lists together', async () => {
            requireKeys([StorePermission.VIEW_LEDGER], [StorePermission.CREATE_SALE, StorePermission.CREATE_RETURN]);
            db.userStorePermission.findMany.mockResolvedValue(
                grantRows([StorePermission.VIEW_LEDGER, StorePermission.CREATE_RETURN]),
            );

            await expect(guard.canActivate(makeContext())).resolves.toBe(true);
            expect(db.userStorePermission.findMany).toHaveBeenCalledTimes(1);
            expect(db.userStorePermission.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { user_id: 'user-1', tenant_id: 'tenant-1' } }),
            );
        });
    });

    /**
     * Across requests the membership and grants come from `AuthCacheService`.
     * What matters is not that they are cached but that a revocation still
     * lands on the very next request: the write that revokes calls
     * `invalidateMember`, and the guard then reads the new answer.
     */
    describe('with the cross-request cache on', () => {
        let cache: AuthCacheService;
        let cached: StorePermissionGuard;

        const memberRow = (role: string) => [
            { tenant_id: 'tenant-1', user_id: 'user-1', role, tenant_deleted_at: null, tenant_timezone: null, roles: [] },
        ];

        beforeEach(() => {
            cache = new AuthCacheService({ ttlMs: 30_000 });
            cached = new StorePermissionGuard(reflector, db as any, cache);
            reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        });

        it('answers a second request without querying the membership or the grants again', async () => {
            db.$queryRaw.mockResolvedValue(memberRow('CASHIER'));
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));

            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);
            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);

            expect(db.$queryRaw).toHaveBeenCalledTimes(1);
            expect(db.userStorePermission.findMany).toHaveBeenCalledTimes(1);
        });

        it('refuses a revoked permission on the next request once the revoke invalidates', async () => {
            db.$queryRaw.mockResolvedValue(memberRow('CASHIER'));
            db.userStorePermission.findMany.mockResolvedValueOnce(grantRows([StorePermission.CREATE_SALE]));
            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);

            // The admin takes CREATE_SALE away; `TeamService` invalidates after commit.
            db.userStorePermission.findMany.mockResolvedValueOnce([]);
            cache.invalidateMember('user-1', 'tenant-1');

            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).rejects.toThrow(
                ForbiddenException,
            );
        });

        it('refuses a removed member on the next request once the removal invalidates', async () => {
            db.$queryRaw.mockResolvedValueOnce(memberRow('CASHIER'));
            db.userStorePermission.findMany.mockResolvedValue(grantRows([StorePermission.CREATE_SALE]));
            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);

            db.$queryRaw.mockResolvedValueOnce([]);
            cache.invalidateMember('user-1', 'tenant-1');

            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).rejects.toThrow(
                'Invalid tenant context',
            );
        });

        it('refuses a demoted owner on the next request once a tenant-wide change invalidates', async () => {
            db.$queryRaw.mockResolvedValueOnce(memberRow('OWNER'));
            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).resolves.toBe(true);

            db.$queryRaw.mockResolvedValueOnce(memberRow('CASHIER'));
            db.userStorePermission.findMany.mockResolvedValue([]);
            cache.invalidateTenant('tenant-1');

            await expect(cached.canActivate(makeContext({ noPresetRole: true }))).rejects.toThrow(
                ForbiddenException,
            );
        });
    });
});
