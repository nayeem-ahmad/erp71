import { Body, Controller, Delete, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ShortLinksService } from './short-links.service';
import { CreateShortLinkDto } from './short-links.dto';

@Controller('short-links')
export class ShortLinksController {
    constructor(private readonly service: ShortLinksService) {}

    /**
     * Public: peek at a target without counting a click. Used by the off-domain
     * interstitial, which re-resolves the code rather than trusting a query
     * param — otherwise anyone could craft an erp71.com link that displays one
     * destination and carries another.
     *
     * No auth guard by design. Covered by the global ThrottlerGuard.
     */
    @Get('resolve/:code')
    peek(@Param('code') code: string) {
        return this.service.resolve(code, false);
    }

    /** Public: resolve and count the click. Called by the /s/[code] handler. */
    @Post('resolve/:code')
    resolve(@Param('code') code: string) {
        return this.service.resolve(code, true);
    }

    @Get()
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    list(@Tenant() tenant: TenantContext) {
        return this.service.list(tenant.tenantId);
    }

    @Post()
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateShortLinkDto) {
        return this.service.createManual(tenant.tenantId, tenant.userId, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    async revoke(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.service.revoke(id, tenant.tenantId);
        return { success: true };
    }
}
