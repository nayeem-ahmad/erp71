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
}
