import { ForbiddenException } from '@nestjs/common';
import { BillingSuspensionGuard } from './billing-suspension.guard';

describe('BillingSuspensionGuard', () => {
    const db = {
        tenant: { findUnique: jest.fn() },
        tenantUser: { findMany: jest.fn() },
    } as any;

    const reflector = { getAllAndOverride: jest.fn() } as any;

    let guard: BillingSuspensionGuard;

    const makeContext = (request: Record<string, unknown>) => ({
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => undefined,
        getClass: () => undefined,
    }) as any;

    const request = (overrides?: Record<string, unknown>) => ({
        method: 'POST',
        path: '/api/v1/sales',
        headers: { 'x-tenant-id': 'tenant-1' },
        user: { userId: 'user-1' },
        ...overrides,
    });

    const suspended = {
        billing_suspended_at: new Date('2026-09-01T00:00:00Z'),
        billing_suspension_reason: 'Unpaid subscription balance of ৳750.00 after 30 days.',
    };

    beforeEach(() => {
        jest.resetAllMocks();
        guard = new BillingSuspensionGuard(db, reflector);
        reflector.getAllAndOverride.mockReturnValue(false);
        db.tenant.findUnique.mockResolvedValue({
            billing_suspended_at: null,
            billing_suspension_reason: null,
        });
        db.tenantUser.findMany.mockResolvedValue([{ tenant_id: 'tenant-1' }]);
    });

    it('blocks a write in a suspended workspace', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request()))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('carries a machine-readable code so the frontend can show the settle-up screen', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await guard.canActivate(makeContext(request())).catch((err: ForbiddenException) => {
            expect(err.getResponse()).toMatchObject({
                code: 'WORKSPACE_SUSPENDED',
                message: suspended.billing_suspension_reason,
            });
        });
        expect.assertions(1);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s so the data stays readable', async (method) => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({ method })))).resolves.toBe(true);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s', async (method) => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({ method })))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a write in a workspace that is not suspended', async () => {
        await expect(guard.canActivate(makeContext(request()))).resolves.toBe(true);
    });

    it.each([
        '/api/v1/billing/checkout-session',
        '/api/v1/auth/login',
        '/api/v1/admin/tenants/tenant-1/payments',
        '/api/v1/support/tickets',
    ])('leaves %s open — it is how the suspension gets lifted', async (path) => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({ path })))).resolves.toBe(true);
    });

    it('does not treat a lookalike path as exempt', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        // `billing-adjacent` must not inherit `billing`'s exemption.
        await expect(guard.canActivate(makeContext(request({ path: '/api/v1/billing-adjacent/x' }))))
            .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ignores the query string when matching exempt paths', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({ path: '/api/v1/billing/confirm?ref=abc' }))))
            .resolves.toBe(true);
    });

    it('lets a platform admin keep working on a suspended tenant', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({
            user: { userId: 'admin-1', isPlatformAdmin: true },
        })))).resolves.toBe(true);
    });

    it('honours an explicit @AllowWhenSuspended opt-out', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);
        reflector.getAllAndOverride.mockReturnValue(true);

        await expect(guard.canActivate(makeContext(request()))).resolves.toBe(true);
    });

    it('ignores unauthenticated requests, which the auth guards own', async () => {
        await expect(guard.canActivate(makeContext(request({ user: undefined })))).resolves.toBe(true);
        expect(db.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('resolves the tenant from a sole membership when no header is sent', async () => {
        db.tenant.findUnique.mockResolvedValue(suspended);

        await expect(guard.canActivate(makeContext(request({ headers: {} }))))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(db.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'tenant-1' },
        }));
    });

    it('stays out of the way when the tenant is ambiguous', async () => {
        // TenantInterceptor rejects this case on its own terms; the guard has no
        // single workspace whose suspension state it could read.
        db.tenantUser.findMany.mockResolvedValue([{ tenant_id: 'a' }, { tenant_id: 'b' }]);

        await expect(guard.canActivate(makeContext(request({ headers: {} })))).resolves.toBe(true);
        expect(db.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('ignores non-http contexts', async () => {
        const context = { getType: () => 'ws' } as any;
        await expect(guard.canActivate(context)).resolves.toBe(true);
    });
});
