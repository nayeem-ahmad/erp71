import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorePermissionGuard } from './store-permission.guard';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_ANY_KEY, STORE_PERMISSIONS_KEY } from './store-permission.decorator';

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
        guard = new StorePermissionGuard(reflector, db as any);
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
            db.userStorePermission.findMany.mockResolvedValue([
                { permission: StorePermission.CREATE_SALE },
            ]);

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
            const second = new StorePermissionGuard(reflector, db as any);
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
        db.userStorePermission.findMany.mockResolvedValue([
            { permission: StorePermission.CREATE_SALE },
        ]);
        await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    });

    it('throws ForbiddenException when permission is missing', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE, StorePermission.EDIT_PRODUCTS]);
        db.userStorePermission.findMany.mockResolvedValue([
            { permission: StorePermission.CREATE_SALE },
            // EDIT_PRODUCTS not granted
        ]);
        await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
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
            db.userStorePermission.findMany.mockResolvedValue([{ permission: StorePermission.CREATE_SALE }]);

            await guard.canActivate(makeContext({ tenantId: 'tenant-victim', storeId: 'store-mine' }));

            expect(db.userStorePermission.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        user_id: 'user-1',
                        store_id: 'store-mine',
                        tenant_id: 'tenant-victim',
                    }),
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
            db.userStorePermission.findMany.mockResolvedValue([{ permission: StorePermission.CREATE_QUOTATION }]);

            await expect(guard.canActivate(makeContext())).resolves.toBe(true);
        });

        it('refuses when the member holds none of them', async () => {
            requireKeys(undefined, [StorePermission.CREATE_SALE, StorePermission.CREATE_QUOTATION]);
            db.userStorePermission.findMany.mockResolvedValue([{ permission: StorePermission.VIEW_PROJECTS }]);

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
            db.userStorePermission.findMany.mockResolvedValue([{ permission: StorePermission.CREATE_SALE }]);

            await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
        });

        it('reads the grants once, for the workspace, for both lists together', async () => {
            requireKeys([StorePermission.VIEW_LEDGER], [StorePermission.CREATE_SALE, StorePermission.CREATE_RETURN]);
            db.userStorePermission.findMany.mockResolvedValue([
                { permission: StorePermission.VIEW_LEDGER },
                { permission: StorePermission.CREATE_RETURN },
            ]);

            await expect(guard.canActivate(makeContext())).resolves.toBe(true);
            expect(db.userStorePermission.findMany).toHaveBeenCalledTimes(1);
            expect(db.userStorePermission.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        permission: {
                            in: [
                                StorePermission.VIEW_LEDGER,
                                StorePermission.CREATE_SALE,
                                StorePermission.CREATE_RETURN,
                            ],
                        },
                    }),
                }),
            );
        });
    });
});
