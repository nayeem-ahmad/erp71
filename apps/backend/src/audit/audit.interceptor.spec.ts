import { Reflector } from '@nestjs/core';
import { of, throwError, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { NO_AUDIT_KEY } from './no-audit.decorator';

function makeContext(request: any) {
    return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
    } as any;
}

function makeRequest(overrides: Record<string, any> = {}) {
    return {
        method: 'POST',
        route: { path: '/api/v1/sales' },
        params: {},
        body: { total: 100 },
        headers: { 'user-agent': 'Chrome' },
        ip: '198.51.100.7',
        user: { userId: 'user-1' },
        tenantId: 'tenant-1',
        ...overrides,
    };
}

describe('AuditInterceptor', () => {
    let audit: { log: jest.Mock };
    let reflector: Reflector;
    let interceptor: AuditInterceptor;

    beforeEach(() => {
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        reflector = new Reflector();
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        interceptor = new AuditInterceptor(audit as any, reflector);
    });

    async function run(request: any, result: unknown = { id: 'sale-1' }) {
        const handler = { handle: () => of(result) };
        await lastValueFrom(await interceptor.intercept(makeContext(request), handler as any));
    }

    it('records a successful tenant-scoped mutation', async () => {
        await run(makeRequest());

        expect(audit.log).toHaveBeenCalledTimes(1);
        expect(audit.log).toHaveBeenCalledWith(
            'sales.create',
            'sales',
            {
                userId: 'user-1',
                tenantId: 'tenant-1',
                ipAddress: '198.51.100.7',
                userAgent: 'Chrome',
            },
            'sale-1',
            { total: 100 },
        );
    });

    it('ignores read-only requests', async () => {
        await run(makeRequest({ method: 'GET' }));
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('honours the @NoAudit opt-out so self-audited modules do not double-log', async () => {
        (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
        await run(makeRequest());
        expect(reflector.getAllAndOverride).toHaveBeenCalledWith(NO_AUDIT_KEY, expect.any(Array));
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('skips requests with no tenant context', async () => {
        await run(makeRequest({ tenantId: undefined }));
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('records a platform-admin mutation with a null tenant', async () => {
        await run(
            makeRequest({
                method: 'DELETE',
                route: { path: '/api/v1/admin/short-links/:id' },
                params: { id: 'link-9' },
                body: {},
                tenantId: undefined,
                isPlatformAdmin: true,
            }),
        );

        expect(audit.log).toHaveBeenCalledWith(
            'short-links.delete',
            'short-links',
            expect.objectContaining({ userId: 'user-1', tenantId: undefined }),
            'link-9',
            { _scope: 'platform' },
        );
    });

    it('marks platform rows with a scope so they are not mistaken for unscoped ones', async () => {
        await run(
            makeRequest({
                route: { path: '/api/v1/admin/blog/posts' },
                body: { title: 'Hello' },
                tenantId: undefined,
                isPlatformAdmin: true,
            }),
        );

        expect(audit.log).toHaveBeenCalledWith(
            'blog.posts.create',
            'blog',
            expect.anything(),
            'sale-1',
            { title: 'Hello', _scope: 'platform' },
        );
    });

    it('does not treat a tenant-less storefront customer as a platform admin', async () => {
        // Storefront customers and portal users are authenticated and carry no
        // tenant either. Only the guard-set flag admits a request.
        await run(
            makeRequest({
                route: { path: '/api/v1/storefront/shop/orders' },
                tenantId: undefined,
                isPlatformAdmin: undefined,
            }),
        );
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('keeps the tenant on a platform admin acting inside a tenant context', async () => {
        await run(makeRequest({ isPlatformAdmin: true }));

        expect(audit.log).toHaveBeenCalledWith(
            'sales.create',
            'sales',
            expect.objectContaining({ tenantId: 'tenant-1' }),
            'sale-1',
            expect.objectContaining({ _scope: 'platform' }),
        );
    });

    it('skips unauthenticated requests', async () => {
        await run(makeRequest({ user: undefined }));
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('does not record when the handler throws', async () => {
        const handler = { handle: () => throwError(() => new Error('boom')) };
        const observable = await interceptor.intercept(makeContext(makeRequest()), handler as any);

        await expect(lastValueFrom(observable)).rejects.toThrow('boom');
        expect(audit.log).not.toHaveBeenCalled();
    });

    it('reads tenant context after the handler runs, since TenantInterceptor is nested inside', async () => {
        // TenantInterceptor is controller-scoped, so it populates request.tenantId
        // only once this global interceptor has already called next.handle().
        const request = makeRequest({ tenantId: undefined });
        const handler = {
            handle: () => {
                request.tenantId = 'tenant-late';
                return of({ id: 'sale-2' });
            },
        };

        await lastValueFrom(await interceptor.intercept(makeContext(request), handler as any));

        expect(audit.log).toHaveBeenCalledWith(
            'sales.create',
            'sales',
            expect.objectContaining({ tenantId: 'tenant-late' }),
            'sale-2',
            expect.anything(),
        );
    });

    it('redacts sensitive body fields and stamps the acting store', async () => {
        await run(
            makeRequest({
                route: { path: '/api/v1/team/invitations' },
                body: { email: 'a@b.com', password: 'hunter2' },
                storeId: 'store-7',
            }),
        );

        expect(audit.log).toHaveBeenCalledWith(
            'team.invitations.create',
            'team',
            expect.anything(),
            'sale-1',
            { email: 'a@b.com', password: '[redacted]', store_id: 'store-7' },
        );
    });

    it('prefers the route param id over the result id', async () => {
        await run(
            makeRequest({
                method: 'PATCH',
                route: { path: '/api/v1/products/:id' },
                params: { id: 'prod-42' },
            }),
            { id: 'ignored' },
        );

        expect(audit.log).toHaveBeenCalledWith(
            'products.update',
            'products',
            expect.anything(),
            'prod-42',
            expect.anything(),
        );
    });

    it('lets the response through when the audit write fails', async () => {
        audit.log.mockRejectedValue(new Error('db down'));
        const handler = { handle: () => of({ id: 'sale-1' }) };

        await expect(
            lastValueFrom(await interceptor.intercept(makeContext(makeRequest()), handler as any)),
        ).resolves.toEqual({ id: 'sale-1' });
    });

    it('lets the response through when audit logging throws synchronously', async () => {
        audit.log.mockImplementation(() => {
            throw new Error('exploded');
        });
        const handler = { handle: () => of({ id: 'sale-1' }) };

        await expect(
            lastValueFrom(await interceptor.intercept(makeContext(makeRequest()), handler as any)),
        ).resolves.toEqual({ id: 'sale-1' });
    });

    it('ignores non-http execution contexts', async () => {
        const context = { ...makeContext(makeRequest()), getType: () => 'rpc' } as any;
        await lastValueFrom(await interceptor.intercept(context, { handle: () => of({}) } as any));
        expect(audit.log).not.toHaveBeenCalled();
    });
});
