import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';

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
}
