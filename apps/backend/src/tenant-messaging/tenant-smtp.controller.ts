import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SETTINGS_ADMIN } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantSmtpService } from './tenant-smtp.service';
import { TestTenantSmtpServerDto, UpdateTenantSmtpServerDto } from './tenant-smtp.dto';

/**
 * The shop's own outgoing mail server, managed by the shop.
 *
 * Unlike the platform-admin sender identity this is safe to hand to a tenant:
 * their server authenticates the address, so a workspace can only send as an
 * address it holds the password for.
 */
@Controller('tenants/email-server')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class TenantSmtpController {
    constructor(private readonly service: TenantSmtpService) {}

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Get()
    get(@Tenant() tenant: TenantContext) {
        return this.service.getForTenant(tenant.tenantId);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Patch()
    update(@Tenant() tenant: TenantContext, @Body() dto: UpdateTenantSmtpServerDto) {
        return this.service.update(tenant.tenantId, dto, tenant.userId);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Delete()
    remove(@Tenant() tenant: TenantContext) {
        return this.service.remove(tenant.tenantId);
    }

    /**
     * Sends through the saved settings, switched on or not. Throttled hard: each
     * call opens a connection to a host the tenant chose.
     */
    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Post('test')
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    test(@Tenant() tenant: TenantContext, @Body() dto: TestTenantSmtpServerDto, @Request() req: any) {
        const to = dto.to?.trim() || req.user?.email;
        if (!to) throw new BadRequestException('Enter an email address to send the test to.');
        return this.service.sendTest(tenant.tenantId, to);
    }
}
