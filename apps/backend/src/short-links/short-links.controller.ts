import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { extractRequestMeta } from '../audit/audit-route.util';
import { ShortLinksService } from './short-links.service';
import { CreateShortLinkDto, TrackShortLinkClickDto } from './short-links.dto';

@Controller('short-links')
export class ShortLinksController {
    constructor(private readonly service: ShortLinksService) {}

    /**
     * Public: peek at a target without counting a click, for anything that needs
     * to know where a code points without being a visit — a preview, a support
     * check, a test.
     *
     * No auth guard by design. Covered by the global ThrottlerGuard.
     */
    @Get('resolve/:code')
    peek(@Param('code') code: string) {
        return this.service.resolve(code, false);
    }

    /**
     * Public: resolve, count the click, and record its context. Called by the
     * /s/[code] handler.
     *
     * The visitor's context arrives in the body because that handler is itself a
     * server-side fetch — the original request's headers do not survive the hop.
     * The IP is the exception: it is read off `X-Forwarded-For` here rather than
     * accepted as a body field. `user_agent` falls back to this request's own
     * header so a direct call is still recorded sensibly.
     */
    @Post('resolve/:code')
    resolve(@Param('code') code: string, @Body() dto: TrackShortLinkClickDto, @Req() req: any) {
        const request = extractRequestMeta(req);
        return this.service.resolve(code, true, {
            referrer: dto?.referrer,
            userAgent: dto?.user_agent ?? request.userAgent,
            query: dto?.query,
            language: dto?.language,
            country: dto?.country,
            city: dto?.city,
            ipAddress: request.ipAddress,
        });
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
