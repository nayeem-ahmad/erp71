import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { TenantBlogController } from './tenant-blog.controller';
import { StorefrontBlogController } from './storefront-blog.controller';

/**
 * The service takes `tenantId` as a plain argument, so its tests stay green no
 * matter what the controller does with auth. The decorators are therefore the
 * thing under test: a `TenantInterceptor` that went missing would leave
 * `@Tenant()` throwing rather than leaking, but a missing
 * `RequireStorePermission` would silently hand a cashier the shop's public
 * voice.
 */
function guardsOn(target: any, method?: string): any[] {
    const source = method ? target.prototype[method] : target;
    return Reflect.getMetadata(GUARDS_METADATA, source) ?? [];
}

function interceptorsOn(target: any): any[] {
    return Reflect.getMetadata(INTERCEPTORS_METADATA, target) ?? [];
}

function permissionsOn(target: any, method: string): any[] {
    return Reflect.getMetadata(STORE_PERMISSIONS_KEY, target.prototype[method]) ?? [];
}

describe('TenantBlogController', () => {
    it('authenticates and scopes every route at class level', () => {
        expect(guardsOn(TenantBlogController)).toEqual([JwtAuthGuard, StorePermissionGuard]);
        expect(interceptorsOn(TenantBlogController)).toContain(TenantInterceptor);
    });

    it('gates reads on VIEW_BLOG', () => {
        for (const method of ['list', 'get', 'listCategories', 'getSettings']) {
            expect(permissionsOn(TenantBlogController, method)).toEqual([StorePermission.VIEW_BLOG]);
        }
    });

    it('gates authoring on MANAGE_BLOG', () => {
        for (const method of ['create', 'update', 'remove', 'setCover', 'removeCover', 'updateSettings']) {
            expect(permissionsOn(TenantBlogController, method)).toEqual([StorePermission.MANAGE_BLOG]);
        }
    });

    it('gates going public — and coming back down — on PUBLISH_BLOG', () => {
        // Taking a live post down changes what the shop is saying in public
        // just as much as putting it up, so `setStatus` is not MANAGE_BLOG.
        expect(permissionsOn(TenantBlogController, 'publish')).toEqual([StorePermission.PUBLISH_BLOG]);
        expect(permissionsOn(TenantBlogController, 'setStatus')).toEqual([StorePermission.PUBLISH_BLOG]);
    });

    it('leaves no mutating route without a permission', () => {
        const mutating = ['create', 'update', 'remove', 'publish', 'setStatus', 'setCover', 'removeCover', 'updateSettings', 'createCategory', 'updateCategory', 'removeCategory'];
        for (const method of mutating) {
            expect(permissionsOn(TenantBlogController, method).length).toBeGreaterThan(0);
        }
    });
});

describe('StorefrontBlogController', () => {
    const service = { listPublic: jest.fn(), getPublicBySlug: jest.fn(), recordView: jest.fn(), listPublishedSlugs: jest.fn() } as any;

    it('carries no guard, like the rest of the storefront surface', () => {
        // Shop owners want these pages found. The service checks that both the
        // storefront and the blog are switched on before returning anything.
        expect(guardsOn(StorefrontBlogController)).toEqual([]);
        expect(guardsOn(StorefrontBlogController, 'list')).toEqual([]);
        expect(guardsOn(StorefrontBlogController, 'get')).toEqual([]);
    });

    it('is mounted under the shop slug so no route can read a blog without one', () => {
        expect(Reflect.getMetadata(PATH_METADATA, StorefrontBlogController)).toBe('storefront/:slug/blog');
    });

    it('passes the shop slug through to every service call', async () => {
        const controller = new StorefrontBlogController(service);

        await controller.list('karim', 'offers', '1', '5');
        expect(service.listPublic).toHaveBeenCalledWith('karim', { categorySlug: 'offers', page: 1, limit: 5 });

        await controller.get('karim', 'eid-sale');
        expect(service.getPublicBySlug).toHaveBeenCalledWith('karim', 'eid-sale');
    });

    it('declares the literal sitemap route before the :postSlug route that would shadow it', () => {
        const order = Object.getOwnPropertyNames(StorefrontBlogController.prototype).filter((k) => k !== 'constructor');
        expect(order.indexOf('sitemap')).toBeLessThan(order.indexOf('get'));
    });
});
