import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksAdminController } from './short-links-admin.controller';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';

/**
 * This controller is the only place in the module where auth is decided, and it
 * declares its guards *per method* rather than once at class level. Nothing else
 * in the suite notices if one of those decorators goes missing: the service
 * tests take a tenantId as a plain argument, so a `list`/`create`/`revoke`
 * silently stripped of `JwtAuthGuard` would leave every existing test green
 * while exposing an unauthenticated cross-tenant write.
 *
 * So the decorator metadata is the thing under test here. Reading it back with
 * `Reflect.getMetadata` is the same mechanism Nest itself uses at request time —
 * these assertions fail for exactly the reason a real request would be let
 * through.
 */
function guardsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(GUARDS_METADATA, source) ?? [];
}

function interceptorsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(INTERCEPTORS_METADATA, source) ?? [];
}

function permissionsOn(target: any, method: string): any[] {
    return Reflect.getMetadata(STORE_PERMISSIONS_KEY, target.prototype[method]) ?? [];
}

describe('ShortLinksController', () => {
    const service = {
        resolve: jest.fn(),
        list: jest.fn(),
        createManual: jest.fn(),
        revoke: jest.fn(),
    } as any;

    let controller: ShortLinksController;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ShortLinksController(service);
    });

    describe('route protection', () => {
        // Every tenant-scoped method needs all three: authentication, the
        // permission check, and the interceptor that establishes tenant scope.
        // Missing the interceptor is the quiet one — the handler would still run,
        // just without a tenant context to scope the query by.
        for (const method of ['list', 'create', 'revoke']) {
            it(`${method}() carries JwtAuthGuard, StorePermissionGuard and TenantInterceptor`, () => {
                expect(guardsOn(ShortLinksController, method)).toEqual(
                    expect.arrayContaining([JwtAuthGuard, StorePermissionGuard]),
                );
                expect(interceptorsOn(ShortLinksController, method)).toEqual(
                    expect.arrayContaining([TenantInterceptor]),
                );
            });

            it(`${method}() requires MANAGE_SHORT_LINKS`, () => {
                expect(permissionsOn(ShortLinksController, method)).toEqual([
                    StorePermission.MANAGE_SHORT_LINKS,
                ]);
            });
        }

        // The two resolve routes are public by design — a customer opening a
        // shared link has no session. Guards are declared per method here, so
        // "public" is the absence of a decorator rather than an explicit opt-out;
        // pinning it keeps a future class-level @UseGuards from silently breaking
        // every short link in circulation.
        for (const method of ['peek', 'resolve']) {
            it(`${method}() stays public`, () => {
                expect(guardsOn(ShortLinksController, method)).toEqual([]);
                expect(interceptorsOn(ShortLinksController, method)).toEqual([]);
                expect(permissionsOn(ShortLinksController, method)).toEqual([]);
            });
        }

        it('declares no class-level guards that would contradict the public routes', () => {
            expect(guardsOn(ShortLinksController)).toEqual([]);
        });
    });

    describe('click counting', () => {
        const req = (headers: Record<string, string> = {}) => ({ headers, socket: {} }) as any;

        it('GET resolve does not count a click', async () => {
            await controller.peek('aB3xK9m');
            expect(service.resolve).toHaveBeenCalledWith('aB3xK9m', false);
        });

        it('POST resolve counts the click', async () => {
            await controller.resolve('aB3xK9m', {}, req());
            expect(service.resolve).toHaveBeenCalledWith('aB3xK9m', true, expect.anything());
        });
    });

    describe('click context', () => {
        const req = (headers: Record<string, string> = {}) => ({ headers, socket: {} }) as any;

        it('passes the visitor context from the body through to the service', async () => {
            await controller.resolve(
                'aB3xK9m',
                {
                    referrer: 'https://l.facebook.com/',
                    user_agent: 'Mozilla/5.0 (iPhone)',
                    query: '?utm_source=fb',
                    language: 'bn-BD,bn;q=0.9',
                    country: 'BD',
                    city: 'Dhaka',
                },
                req(),
            );

            expect(service.resolve).toHaveBeenCalledWith(
                'aB3xK9m',
                true,
                expect.objectContaining({
                    referrer: 'https://l.facebook.com/',
                    userAgent: 'Mozilla/5.0 (iPhone)',
                    query: '?utm_source=fb',
                    language: 'bn-BD,bn;q=0.9',
                    country: 'BD',
                    city: 'Dhaka',
                }),
            );
        });

        it('takes the IP off X-Forwarded-For, never from the body', async () => {
            // This endpoint is public, so a body field claiming an address would
            // be worth exactly nothing. The header is at least the one the proxy
            // in front of us wrote.
            await controller.resolve('aB3xK9m', {} as any, req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));

            expect(service.resolve).toHaveBeenCalledWith(
                'aB3xK9m',
                true,
                expect.objectContaining({ ipAddress: '203.0.113.9' }),
            );
        });

        it('falls back to the request user agent when the body carries none', async () => {
            // Covers anything calling the endpoint directly rather than through
            // the /s/ handler, which would otherwise record a device-less click.
            await controller.resolve('aB3xK9m', {} as any, req({ 'user-agent': 'curl/8.4.0' }));

            expect(service.resolve).toHaveBeenCalledWith(
                'aB3xK9m',
                true,
                expect.objectContaining({ userAgent: 'curl/8.4.0' }),
            );
        });

        it('still resolves when there is no body at all', () => {
            // A POST with no JSON body leaves the dto undefined. Reading fields
            // off it unguarded would turn a resolvable link into a 500, i.e. a
            // dead short link, over missing telemetry.
            expect(() => controller.resolve('aB3xK9m', undefined as any, req())).not.toThrow();
            expect(service.resolve).toHaveBeenCalledWith(
                'aB3xK9m',
                true,
                expect.objectContaining({ referrer: undefined }),
            );
        });
    });

    describe('tenant scoping', () => {
        const tenant = { tenantId: 'tenant-1', userId: 'user-1' } as any;

        it('lists with the request tenant, never unscoped', async () => {
            await controller.list(tenant);
            expect(service.list).toHaveBeenCalledWith('tenant-1');
        });

        it('creates against the request tenant and user', async () => {
            await controller.create(tenant, { target_url: 'https://example.com' } as any);
            expect(service.createManual).toHaveBeenCalledWith('tenant-1', 'user-1', {
                target_url: 'https://example.com',
            });
        });

        it('revokes scoped to the request tenant', async () => {
            await controller.revoke(tenant, 'link-1');
            expect(service.revoke).toHaveBeenCalledWith('link-1', 'tenant-1');
        });
    });
});

describe('ShortLinksAdminController', () => {
    const service = { list: jest.fn(), createManual: jest.fn(), revoke: jest.fn() } as any;

    let controller: ShortLinksAdminController;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ShortLinksAdminController(service);
    });

    it('is guarded at class level by JwtAuthGuard and PlatformAdminGuard', () => {
        expect(guardsOn(ShortLinksAdminController)).toEqual(
            expect.arrayContaining([JwtAuthGuard, PlatformAdminGuard]),
        );
    });

    it('lists platform-owned links, which the service reads as tenant_id: null', async () => {
        await controller.list();
        expect(service.list).toHaveBeenCalledWith(null);
    });

    it('creates platform-owned links', async () => {
        await controller.create({ user: { userId: 'staff-1' } }, { target_url: 'https://erp71.com' } as any);
        expect(service.createManual).toHaveBeenCalledWith(null, 'staff-1', {
            target_url: 'https://erp71.com',
        });
    });
});
