import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';
import { UpdateLocalizationSettingsDto } from './localization-settings.dto';

@Injectable()
export class TenantsService {
    constructor(private readonly db: DatabaseService) {}

    async updateStorefrontSettings(tenantId: string, dto: StorefrontSettingsDto) {
        // Validate slug format if provided
        if (dto.storefront_slug !== undefined && dto.storefront_slug !== null && dto.storefront_slug !== '') {
            const slugRegex = /^[a-z0-9-]{1,50}$/;
            if (!slugRegex.test(dto.storefront_slug)) {
                throw new BadRequestException(
                    'Slug must be lowercase letters, numbers, and hyphens only (max 50 chars)',
                );
            }
        }

            const data: Record<string, string | boolean | null> = {};
            if (dto.storefront_slug !== undefined) data.storefront_slug = dto.storefront_slug || null;
            if (dto.storefront_enabled !== undefined) data.storefront_enabled = dto.storefront_enabled;
            if (dto.storefront_banner !== undefined) data.storefront_banner = dto.storefront_banner || null;
            if (dto.storefront_hero_image !== undefined) data.storefront_hero_image = dto.storefront_hero_image || null;
            if (dto.storefront_hero_headline !== undefined) data.storefront_hero_headline = dto.storefront_hero_headline || null;

        return this.db.tenant.update({
            where: { id: tenantId },
                data,
            select: {
                id: true,
                name: true,
                storefront_slug: true,
                storefront_enabled: true,
                storefront_banner: true,
                storefront_hero_image: true,
                storefront_hero_headline: true,
            },
        });
    }

    async getStorefrontSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                storefront_slug: true,
                storefront_enabled: true,
                storefront_banner: true,
                storefront_hero_image: true,
                storefront_hero_headline: true,
            },
        });
    }

    async getBranding(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                brand_primary_color: true,
                brand_logo_url: true,
                brand_favicon_url: true,
                brand_business_name: true,
            },
        });
    }

    async getTaxSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                default_vat_rate: true,
                vat_registration_no: true,
                business_tin: true,
            },
        });
    }

    async updateTaxSettings(tenantId: string, dto: { default_vat_rate?: number | null; vat_registration_no?: string | null; business_tin?: string | null }) {
        const data: Record<string, number | string | null> = {};
        if (dto.default_vat_rate !== undefined) data.default_vat_rate = dto.default_vat_rate;
        if (dto.vat_registration_no !== undefined) data.vat_registration_no = dto.vat_registration_no || null;
        if (dto.business_tin !== undefined) data.business_tin = dto.business_tin || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                default_vat_rate: true,
                vat_registration_no: true,
                business_tin: true,
            },
        });
    }

    async updateBranding(tenantId: string, dto: UpdateBrandingDto) {
        const data: Record<string, string | null> = {};
        if (dto.brand_primary_color !== undefined) data.brand_primary_color = dto.brand_primary_color || null;
        if (dto.brand_logo_url !== undefined) data.brand_logo_url = dto.brand_logo_url || null;
        if (dto.brand_favicon_url !== undefined) data.brand_favicon_url = dto.brand_favicon_url || null;
        if (dto.brand_business_name !== undefined) data.brand_business_name = dto.brand_business_name || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                brand_primary_color: true,
                brand_logo_url: true,
                brand_favicon_url: true,
                brand_business_name: true,
            },
        });
    }

    async getSmsSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                sms_enabled: true,
                sms_on_sale: true,
                sms_on_low_stock: true,
            },
        });
    }

    async updateSmsSettings(
        tenantId: string,
        dto: { sms_enabled?: boolean; sms_on_sale?: boolean; sms_on_low_stock?: boolean },
    ) {
        const data: Record<string, boolean> = {};
        if (dto.sms_enabled !== undefined) data.sms_enabled = dto.sms_enabled;
        if (dto.sms_on_sale !== undefined) data.sms_on_sale = dto.sms_on_sale;
        if (dto.sms_on_low_stock !== undefined) data.sms_on_low_stock = dto.sms_on_low_stock;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                sms_enabled: true,
                sms_on_sale: true,
                sms_on_low_stock: true,
            },
        });
    }

    async getReportSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                report_weekly_enabled: true,
                report_monthly_enabled: true,
                report_email: true,
            },
        });
    }

    async updateReportSettings(
        tenantId: string,
        dto: { report_weekly_enabled?: boolean; report_monthly_enabled?: boolean; report_email?: string | null },
    ) {
        const data: Record<string, boolean | string | null> = {};
        if (dto.report_weekly_enabled !== undefined) data.report_weekly_enabled = dto.report_weekly_enabled;
        if (dto.report_monthly_enabled !== undefined) data.report_monthly_enabled = dto.report_monthly_enabled;
        if (dto.report_email !== undefined) data.report_email = dto.report_email || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                report_weekly_enabled: true,
                report_monthly_enabled: true,
                report_email: true,
            },
        });
    }

    async getLocalizationSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });
    }

    async updateLocalizationSettings(tenantId: string, dto: UpdateLocalizationSettingsDto) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                localization_enabled: true,
                secondary_locale: true,
            },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        if (!tenant.localization_enabled) {
            throw new BadRequestException('Localization is not enabled for this tenant.');
        }

        const allowedLocales = new Set(['en']);
        if (tenant.secondary_locale) {
            allowedLocales.add(tenant.secondary_locale);
        }

        if (dto.default_locale !== undefined && !allowedLocales.has(dto.default_locale)) {
            throw new BadRequestException('Default locale is not enabled for this tenant.');
        }

        const data: Record<string, string> = {};
        if (dto.default_locale !== undefined) data.default_locale = dto.default_locale;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });
    }
}
