import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';

@Injectable()
export class TenantsService {
    constructor(private db: DatabaseService) {}

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

        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.storefront_slug !== undefined ? { storefront_slug: dto.storefront_slug || null } : {}),
                ...(dto.storefront_enabled !== undefined ? { storefront_enabled: dto.storefront_enabled } : {}),
                ...(dto.storefront_banner !== undefined ? { storefront_banner: dto.storefront_banner || null } : {}),
            },
            select: {
                id: true,
                name: true,
                storefront_slug: true,
                storefront_enabled: true,
                storefront_banner: true,
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
        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.default_vat_rate !== undefined ? { default_vat_rate: dto.default_vat_rate } : {}),
                ...(dto.vat_registration_no !== undefined ? { vat_registration_no: dto.vat_registration_no || null } : {}),
                ...(dto.business_tin !== undefined ? { business_tin: dto.business_tin || null } : {}),
            },
            select: {
                default_vat_rate: true,
                vat_registration_no: true,
                business_tin: true,
            },
        });
    }

    async updateBranding(tenantId: string, dto: UpdateBrandingDto) {
        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.brand_primary_color !== undefined
                    ? { brand_primary_color: dto.brand_primary_color || null }
                    : {}),
                ...(dto.brand_logo_url !== undefined
                    ? { brand_logo_url: dto.brand_logo_url || null }
                    : {}),
                ...(dto.brand_favicon_url !== undefined
                    ? { brand_favicon_url: dto.brand_favicon_url || null }
                    : {}),
                ...(dto.brand_business_name !== undefined
                    ? { brand_business_name: dto.brand_business_name || null }
                    : {}),
            },
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
        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.sms_enabled !== undefined ? { sms_enabled: dto.sms_enabled } : {}),
                ...(dto.sms_on_sale !== undefined ? { sms_on_sale: dto.sms_on_sale } : {}),
                ...(dto.sms_on_low_stock !== undefined ? { sms_on_low_stock: dto.sms_on_low_stock } : {}),
            },
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
        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.report_weekly_enabled !== undefined ? { report_weekly_enabled: dto.report_weekly_enabled } : {}),
                ...(dto.report_monthly_enabled !== undefined ? { report_monthly_enabled: dto.report_monthly_enabled } : {}),
                ...(dto.report_email !== undefined ? { report_email: dto.report_email || null } : {}),
            },
            select: {
                report_weekly_enabled: true,
                report_monthly_enabled: true,
                report_email: true,
            },
        });
    }
}
