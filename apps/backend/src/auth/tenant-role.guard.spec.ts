import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@erp71/shared-types';
import { TenantRoleGuard } from './tenant-role.guard';

/**
 * The single row the membership loader's joined query returns — the guard reads
 * the membership through that loader, not a nested Prisma select.
 */
function roleRows(role: UserRole, roleNames: string[] = []) {
    return [
        {
            tenant_id: 't1',
            user_id: 'u1',
            role,
            tenant_deleted_at: null,
            tenant_timezone: null,
            roles: roleNames.map((name) => ({ name, record_scope: 'ALL' })),
        },
    ];
}

function contextFor(request: any) {
    return {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => request }),
    } as any;
}

describe('TenantRoleGuard', () => {
    // The membership is read through the shared loader's joined query.
    const db = { $queryRaw: jest.fn() };
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
        db.$queryRaw.mockResolvedValue(roleRows(UserRole.ACCOUNTANT));
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
        expect(request.tenantRole).toBe(UserRole.ACCOUNTANT);
    });

    it('allows a member whose stored role misses but whose role set opens the gate', async () => {
        // A Tenant Admin also holding Accounting User: the enum stores MANAGER, so the
        // gate has to come from the roles they hold rather than the single column.
        db.$queryRaw.mockResolvedValue(roleRows(UserRole.MANAGER, ['Tenant Admin', 'Accounting User']));
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('lets Tenant Admin alone through the accounting gate', async () => {
        db.$queryRaw.mockResolvedValue(roleRows(UserRole.MANAGER, ['Tenant Admin']));
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('rejects a member whose roles open no required gate', async () => {
        db.$queryRaw.mockResolvedValue(roleRows(UserRole.CASHIER, ['Sales Manager']));
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
    });

    it('never lets a role name grant OWNER', async () => {
        (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['OWNER']);
        db.$queryRaw.mockResolvedValue(roleRows(UserRole.MANAGER, ['Tenant Admin']));
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
    });

    it('rejects a request with no tenant context', async () => {
        await expect(
            guard.canActivate(contextFor({ user: { userId: 'u1' }, headers: {} })),
        ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a user who is not a member of the tenant', async () => {
        db.$queryRaw.mockResolvedValue([]);
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(UnauthorizedException);
    });
});
