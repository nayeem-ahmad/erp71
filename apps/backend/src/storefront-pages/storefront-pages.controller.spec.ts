import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { StorefrontPagesController } from './storefront-pages.controller';
import { PublicStorefrontPagesController } from './public-storefront-pages.controller';

/**
 * The service takes `tenantId` as a plain argument, so its tests stay green no
 * matter what the controller does with auth. The decorators are therefore the
 * thing under test — the same reasoning as the tenant blog's controller spec.
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

const MANAGEMENT_ROUTES = [
    'list',
    'get',
    'create',
    'update',
    'setStatus',
    'remove',
    'listMenu',
    'createMenuLink',
    'updateMenuLink',
    'setMenuLinkVisibility',
    'removeMenuLink',
    'reorderMenu',
];

describe('StorefrontPagesController', () => {
    it('authenticates and scopes every route at class level', () => {
        expect(guardsOn(StorefrontPagesController)).toEqual([JwtAuthGuard, StorePermissionGuard]);
        expect(interceptorsOn(StorefrontPagesController)).toContain(TenantInterceptor);
    });

    it('leaves no route without MANAGE_STOREFRONT_PAGES', () => {
        for (const method of MANAGEMENT_ROUTES) {
            expect(permissionsOn(StorefrontPagesController, method)).toEqual([
                StorePermission.MANAGE_STOREFRONT_PAGES,
            ]);
        }
    });

    it('does not sit under /storefront, where :slug would shadow it', () => {
        // `StorefrontController` claims `GET /storefront/:slug` for the public
        // shop read. A management route nested under that prefix would be
        // matched by the wildcard depending on module registration order.
        expect(Reflect.getMetadata(PATH_METADATA, StorefrontPagesController)).toBe('storefront-pages');
    });
});

describe('PublicStorefrontPagesController', () => {
    it('is unguarded, like the rest of the public storefront', () => {
        expect(guardsOn(PublicStorefrontPagesController)).toEqual([]);
    });

    it('declares the sitemap route before the catch-all page slug', () => {
        // Nest matches in declaration order within a controller, so
        // `pages/:pageSlug` would otherwise swallow `pages/sitemap`.
        const methods = Object.getOwnPropertyNames(PublicStorefrontPagesController.prototype);
        expect(methods.indexOf('sitemap')).toBeLessThan(methods.indexOf('getPage'));
    });
});
