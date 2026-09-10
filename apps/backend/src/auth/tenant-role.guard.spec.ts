import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@erp71/shared-types';
import { TenantRoleGuard } from './tenant-role.guard';

function contextFor(request: any) {
    return {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => request }),
    } as any;
}

describe('TenantRoleGuard', () => {
    const db = { tenantUser: { findUnique: jest.fn() } };
    let reflector: Reflector;
    let guard: TenantRoleGuard;
    let request: any;

    beforeEach(() => {
        jest.clearAllMocks();
        reflector = { getAllAndOverride: jest.fn().mockReturnValue(['OWNER', 'ACCOUNTANT']) } as any;
        guard = new TenantRoleGuard(reflector, db as any);
        request = { user: { userId: 'u1' }, headers: { 'x-tenant-id': 't1' } };
    });

    it('allows a route with no role metadata', async () => {
        (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('allows a member whose stored coarse role matches', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.ACCOUNTANT, roles: [] });
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
        expect(request.tenantRole).toBe(UserRole.ACCOUNTANT);
    });

    it('allows a member whose stored role misses but whose role set opens the gate', async () => {
        // A Tenant Admin also holding Accounting User: the enum stores MANAGER, so the
        // gate has to come from the roles they hold rather than the single column.
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.MANAGER,
            roles: [
                { tenantRole: { name: 'Tenant Admin' } },
                { tenantRole: { name: 'Accounting User' } },
            ],
        });
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('lets Tenant Admin alone through the accounting gate', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.MANAGER,
            roles: [{ tenantRole: { name: 'Tenant Admin' } }],
        });
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('rejects a member whose roles open no required gate', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            roles: [{ tenantRole: { name: 'Sales Manager' } }],
        });
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
    });

    it('never lets a role name grant OWNER', async () => {
        (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['OWNER']);
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.MANAGER,
            roles: [{ tenantRole: { name: 'Tenant Admin' } }],
        });
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
    });

    it('rejects a request with no tenant context', async () => {
        await expect(
            guard.canActivate(contextFor({ user: { userId: 'u1' }, headers: {} })),
        ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a user who is not a member of the tenant', async () => {
        db.tenantUser.findUnique.mockResolvedValue(null);
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(UnauthorizedException);
    });
});
