import { Controller, Get, Patch, Post, Delete, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { StorefrontMediaService } from './storefront-media.service';
import { StorefrontSettingsDto, UploadStorefrontImageDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';
import { UpdateDashboardSettingsDto } from './dashboard-settings.dto';
import { UpdateLocalizationSettingsDto } from './localization-settings.dto';
import { UpdatePasswordPolicyDto } from './password-policy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TenantsController {
    constructor(
        private readonly tenantsService: TenantsService,
        private readonly storefrontMedia: StorefrontMediaService,
    ) {}

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

    /**
     * Store a cropped hero image or logo and hand back its URL, which the
     * settings PATCH above then persists. Throttled like the other image
     * routes: the body carries a whole picture.
     */
    @Post('storefront-image')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    async uploadStorefrontImage(
        @Tenant() tenant: TenantContext,
        @Body() dto: UploadStorefrontImageDto,
    ) {
        return this.storefrontMedia.upload(tenant.tenantId, dto);
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

    @Get('localization-settings')
    async getLocalizationSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getLocalizationSettings(tenant.tenantId);
    }

    @Patch('localization-settings')
    async updateLocalizationSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateLocalizationSettingsDto,
    ) {
        return this.tenantsService.updateLocalizationSettings(tenant.tenantId, dto);
    }

    @Get('dashboard-settings')
    async getDashboardSettings(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getDashboardSettings(tenant.tenantId);
    }

    @Patch('dashboard-settings')
    async updateDashboardSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateDashboardSettingsDto,
    ) {
        return this.tenantsService.updateDashboardSettings(tenant.tenantId, dto, tenant.userRole);
    }

    /**
     * Readable by every member: the change-password form renders the rules it is
     * about to enforce. Only the PATCH is admin-gated.
     */
    @Get('password-policy')
    async getPasswordPolicy(@Tenant() tenant: TenantContext) {
        return this.tenantsService.getPasswordPolicy(tenant.tenantId);
    }

    @Patch('password-policy')
    async updatePasswordPolicy(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdatePasswordPolicyDto,
    ) {
        return this.tenantsService.updatePasswordPolicy(tenant.tenantId, dto, tenant.userRole);
    }

    @Delete('data')
    async clearData(
        @Tenant() tenant: TenantContext,
        @Query('mode') mode: string,
    ) {
        return this.tenantsService.clearData(tenant.tenantId, mode as 'transactions' | 'all', tenant.userRole);
    }
}
