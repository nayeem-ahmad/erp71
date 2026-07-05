import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePlanFeatures, parsePlanFeatures } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CreateAddonModuleDto, UpdateAddonModuleDto } from './addon-modules.dto';

const ACTIVE_ADDON_STATUSES = ['ACTIVE', 'TRIALING'] as const;
type AddonSubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';

@Injectable()
export class AddonModulesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    /** Active, purchasable catalog — what tenants browse on the billing page. */
    async listCatalogForTenants() {
        const addons = await this.db.addonModule.findMany({
            where: { is_active: true },
            orderBy: { sort_order: 'asc' },
        });
        return addons.map((addon) => this.mapAddon(addon));
    }

    async listAllForAdmin() {
        const addons = await this.db.addonModule.findMany({
            orderBy: { sort_order: 'asc' },
            include: { _count: { select: { subscriptions: true } } },
        });
        return addons.map((addon) => this.mapAddon(addon));
    }

    async getByIdForAdmin(id: string) {
        return this.mapAddon(await this.findByIdOrThrow(id));
    }

    async createAddon(dto: CreateAddonModuleDto, userId: string) {
        const code = dto.code.trim().toUpperCase();
        const existing = await this.db.addonModule.findUnique({ where: { code } });
        if (existing) {
            throw new ConflictException(`An add-on with code "${code}" already exists.`);
        }

        const featuresJson = parsePlanFeatures(dto.features);
        const created = await this.db.addonModule.create({
            data: {
                code,
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                category: dto.category?.trim() || null,
                monthly_price: dto.monthly_price,
                yearly_price: dto.yearly_price ?? null,
                is_active: dto.is_active ?? true,
                sort_order: dto.sort_order ?? 0,
                features_json: featuresJson,
            },
        });

        await this.audit.log(
            'addon_module.create',
            'addon_module',
            { userId },
            created.id,
            { code, name: created.name, monthly_price: Number(created.monthly_price) },
        );

        return this.mapAddon(created);
    }

    async updateAddon(id: string, dto: UpdateAddonModuleDto, userId: string) {
        const existing = await this.findByIdOrThrow(id);
        const featuresJson = parsePlanFeatures(dto.features);

        const updated = await this.db.addonModule.update({
            where: { id },
            data: {
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                category: dto.category?.trim() || null,
                monthly_price: dto.monthly_price,
                yearly_price: dto.yearly_price ?? null,
                is_active: dto.is_active,
                sort_order: dto.sort_order ?? 0,
                features_json: featuresJson,
            },
        });

        await this.audit.log(
            'addon_module.update',
            'addon_module',
            { userId },
            id,
            {
                before: {
                    name: existing.name,
                    monthly_price: Number(existing.monthly_price),
                    is_active: existing.is_active,
                    features_json: normalizePlanFeatures(existing.features_json as Record<string, unknown>),
                },
                after: {
                    name: updated.name,
                    monthly_price: Number(updated.monthly_price),
                    is_active: updated.is_active,
                    features_json: featuresJson,
                },
            },
        );

        return this.mapAddon(updated);
    }

    /** Active (or trialing, unexpired) add-on subscriptions for a tenant. */
    async getActiveForTenant(tenantId: string) {
        const rows = await this.db.tenantAddonSubscription.findMany({
            where: {
                tenant_id: tenantId,
                status: { in: [...ACTIVE_ADDON_STATUSES] },
                current_period_end: { gt: new Date() },
            },
            include: { addon: true },
            orderBy: { current_period_end: 'desc' },
        });

        return rows.map((row) => ({
            addon: this.mapAddon(row.addon),
            status: row.status,
            current_period_start: row.current_period_start,
            current_period_end: row.current_period_end,
            cancel_at_period_end: row.cancel_at_period_end,
        }));
    }

    async cancelAddonAtPeriodEnd(tenantId: string, addonCode: string) {
        const addon = await this.findActiveByCodeOrThrow(addonCode);
        const existing = await this.db.tenantAddonSubscription.findUnique({
            where: { tenant_id_addon_id: { tenant_id: tenantId, addon_id: addon.id } },
        });

        if (!existing) {
            throw new NotFoundException(`No "${addon.name}" add-on subscription was found for this tenant.`);
        }

        return this.db.tenantAddonSubscription.update({
            where: { tenant_id_addon_id: { tenant_id: tenantId, addon_id: addon.id } },
            data: { cancel_at_period_end: true },
        });
    }

    async findActiveByCodeOrThrow(code: string) {
        const addon = await this.db.addonModule.findUnique({ where: { code } });
        if (!addon || !addon.is_active) {
            throw new BadRequestException(`Add-on "${code}" is not available.`);
        }
        return addon;
    }

    /** Resolves a set of add-on codes to their catalog rows for a checkout — throws if any is unknown/inactive. */
    async getActiveAddonsByCodes(codes: string[]) {
        const uniqueCodes = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
        return Promise.all(uniqueCodes.map((code) => this.findActiveByCodeOrThrow(code)));
    }

    /** Grants or renews a tenant's add-on subscription. Called by BillingService after a successful charge. */
    async grantOrRenewSubscription(input: {
        tenantId: string;
        addonId: string;
        status: AddonSubscriptionStatus;
        periodStart: Date;
        periodEnd: Date;
        providerName?: string;
        providerSubscriptionRef?: string;
    }) {
        return this.db.tenantAddonSubscription.upsert({
            where: { tenant_id_addon_id: { tenant_id: input.tenantId, addon_id: input.addonId } },
            update: {
                status: input.status,
                current_period_start: input.periodStart,
                current_period_end: input.periodEnd,
                cancel_at_period_end: false,
                provider_name: input.providerName,
                provider_subscription_ref: input.providerSubscriptionRef,
            },
            create: {
                tenant_id: input.tenantId,
                addon_id: input.addonId,
                status: input.status,
                current_period_start: input.periodStart,
                current_period_end: input.periodEnd,
                provider_name: input.providerName,
                provider_subscription_ref: input.providerSubscriptionRef,
            },
        });
    }

    private async findByIdOrThrow(id: string) {
        const addon = await this.db.addonModule.findUnique({
            where: { id },
            include: { _count: { select: { subscriptions: true } } },
        });

        if (!addon) {
            throw new NotFoundException('Add-on module was not found.');
        }

        return addon;
    }

    private mapAddon(addon: {
        id: string;
        code: string;
        name: string;
        description: string | null;
        category: string | null;
        monthly_price: unknown;
        yearly_price: unknown;
        features_json: unknown;
        is_active: boolean;
        sort_order: number;
        _count?: { subscriptions: number };
    }) {
        return {
            id: addon.id,
            code: addon.code,
            name: addon.name,
            description: addon.description,
            category: addon.category,
            monthly_price: Number(addon.monthly_price),
            yearly_price: addon.yearly_price === null ? null : Number(addon.yearly_price),
            features_json: normalizePlanFeatures(addon.features_json as Record<string, unknown>),
            is_active: addon.is_active,
            sort_order: addon.sort_order,
            subscriber_count: addon._count?.subscriptions ?? 0,
        };
    }
}
