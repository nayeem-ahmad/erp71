import { Controller, Get, Patch, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';
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

    @Get('branding')
    async getBranding(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getBranding(tenant.tenantId);
    }

    @Patch('branding')
    async updateBranding(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateBrandingDto,
    ) {
        return this.tenantsService.updateBranding(tenant.tenantId, dto);
    }

    @Get('tax-settings')
    async getTaxSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getTaxSettings(tenant.tenantId);
    }

    @Patch('tax-settings')
    async updateTaxSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: { default_vat_rate?: number | null; vat_registration_no?: string | null; business_tin?: string | null },
    ) {
        return this.tenantsService.updateTaxSettings(tenant.tenantId, dto);
    }

    @Get('sms-settings')
    async getSmsSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getSmsSettings(tenant.tenantId);
    }

    @Patch('sms-settings')
    async updateSmsSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: { sms_enabled?: boolean; sms_on_sale?: boolean; sms_on_low_stock?: boolean },
    ) {
        return this.tenantsService.updateSmsSettings(tenant.tenantId, dto);
    }

    @Get('report-settings')
    async getReportSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getReportSettings(tenant.tenantId);
    }

    @Patch('report-settings')
    async updateReportSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: { report_weekly_enabled?: boolean; report_monthly_enabled?: boolean; report_email?: string | null },
    ) {
        return this.tenantsService.updateReportSettings(tenant.tenantId, dto);
    }
}
