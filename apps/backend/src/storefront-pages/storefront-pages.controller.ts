import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { StorefrontPagesService } from './storefront-pages.service';
import {
    ReorderStorefrontMenuDto,
    StorefrontMenuLinkVisibilityDto,
    StorefrontPageStatusDto,
    UpsertStorefrontMenuLinkDto,
    UpsertStorefrontPageDto,
} from './storefront-pages.dto';

/**
 * A shop's standing storefront pages, managed from inside the app.
 *
 * Its own path rather than `storefront/...`: `StorefrontController` claims
 * `GET /storefront/:slug` for the public shop read, and any management route
 * nested under it would be shadowed by that wildcard depending on module order.
 */
@Controller('storefront-pages')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class StorefrontPagesController {
    constructor(private readonly service: StorefrontPagesService) {}

    @Get()
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    list(@Tenant() tenant: TenantContext) {
        return this.service.listPages(tenant.tenantId);
    }

    /**
     * Declared before `:id`, which would otherwise swallow it — the same
     * ordering rule the storefront controller follows for `orders`.
     */
    @Get('menu')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    listMenu(@Tenant() tenant: TenantContext) {
        return this.service.listMenuLinks(tenant.tenantId);
    }

    @Post('menu')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    createMenuLink(@Tenant() tenant: TenantContext, @Body() dto: UpsertStorefrontMenuLinkDto) {
        return this.service.createMenuLink(tenant.tenantId, dto);
    }

    @Patch('menu/reorder')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    reorderMenu(@Tenant() tenant: TenantContext, @Body() dto: ReorderStorefrontMenuDto) {
        return this.service.reorderMenu(tenant.tenantId, dto);
    }

    @Patch('menu/:id')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    updateMenuLink(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpsertStorefrontMenuLinkDto,
    ) {
        return this.service.updateMenuLink(tenant.tenantId, id, dto);
    }

    @Patch('menu/:id/visibility')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    setMenuLinkVisibility(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: StorefrontMenuLinkVisibilityDto,
    ) {
        return this.service.setMenuLinkVisibility(tenant.tenantId, id, dto.visible);
    }

    @Delete('menu/:id')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    removeMenuLink(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.removeMenuLink(tenant.tenantId, id);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getPage(tenant.tenantId, id);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    create(@Tenant() tenant: TenantContext, @Body() dto: UpsertStorefrontPageDto) {
        return this.service.createPage(tenant.tenantId, dto);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpsertStorefrontPageDto,
    ) {
        return this.service.updatePage(tenant.tenantId, id, dto);
    }

    @Patch(':id/status')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    setStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: StorefrontPageStatusDto,
    ) {
        return this.service.setPageStatus(tenant.tenantId, id, dto.status);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_STOREFRONT_PAGES)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.removePage(tenant.tenantId, id);
    }
}
