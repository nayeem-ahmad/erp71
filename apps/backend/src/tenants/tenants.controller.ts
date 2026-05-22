import { Controller, Get, Patch, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TenantsController {
    constructor(private readonly tenantsService: TenantsService) {}

    @Get('storefront-settings')
    async getStorefrontSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getStorefrontSettings(tenant.tenantId);
    }

    @Patch('storefront-settings')
    async updateStorefrontSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: StorefrontSettingsDto,
    ) {
        return this.tenantsService.updateStorefrontSettings(tenant.tenantId, dto);
    }
}
