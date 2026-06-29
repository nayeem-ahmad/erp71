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
        // Override storeId on request to undefined
        (ctx.switchToHttp().getRequest() as any).storeId = undefined;
        await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when userId is missing', async () => {
        reflector.getAllAndOverride.mockReturnValue([StorePermission.CREATE_SALE]);
        const ctx = makeContext();
        (ctx.switchToHttp().getRequest() as any).user = undefined;
        await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
});
