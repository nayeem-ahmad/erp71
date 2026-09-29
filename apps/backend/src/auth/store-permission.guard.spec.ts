import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorePermissionGuard } from './store-permission.guard';
import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from './store-permission.decorator';

const makeContext = (overrides: Partial<{
    userId: string;
    storeId: string;
    tenantId: string;
    userRole: string;
}> = {}) => {
    const req = {
        user: { userId: overrides.userId ?? 'user-1' },
        storeId: overrides.storeId ?? 'store-1',
        tenantId: overrides.tenantId ?? 'tenant-1',
        userRole: overrides.userRole ?? 'CASHIER',
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
        tenantUser: {
            findUnique: jest.fn(),
        },
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
});
