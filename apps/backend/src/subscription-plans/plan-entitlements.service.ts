import { ForbiddenException, Injectable } from '@nestjs/common';
import { hasPlanEntitlement, mergeAddonFeatures, normalizePlanFeatures } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

const ACTIVE_ADDON_STATUSES = ['ACTIVE', 'TRIALING'] as const;

@Injectable()
export class PlanEntitlementsService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Base plan entitlements unioned with every currently active add-on's
     * entitlements. Add-ons only ever grant capability on top of the plan —
     * see `mergeAddonFeatures` in @erp71/shared-types.
     */
    async getFeaturesForTenant(tenantId: string) {
        const [subscription, activeAddons] = await Promise.all([
            this.db.tenantSubscription.findUnique({
                where: { tenant_id: tenantId },
                include: { plan: true },
            }),
            this.db.tenantAddonSubscription.findMany({
                where: {
                    tenant_id: tenantId,
                    status: { in: [...ACTIVE_ADDON_STATUSES] },
                    current_period_end: { gt: new Date() },
                },
                include: { addon: true },
            }),
        ]);

        const planFeatures = normalizePlanFeatures(
            subscription?.plan?.features_json as Record<string, unknown> | undefined,
            subscription?.plan?.code ?? 'FREE',
        );

        return mergeAddonFeatures(
            planFeatures,
            activeAddons.map((row) => row.addon.features_json as Record<string, unknown>),
        );
    }

    async assertProductQuota(tenantId: string, additionalCount = 1) {
        const features = await this.getFeaturesForTenant(tenantId);
        const maxSkus = Number(features.maxSkus);
        if (!Number.isFinite(maxSkus) || maxSkus < 0) {
            return;
        }

        const currentCount = await this.db.product.count({
            where: { tenant_id: tenantId, deleted_at: null },
        });

        if (currentCount + additionalCount > maxSkus) {
            throw new ForbiddenException(
                `Your plan allows up to ${maxSkus} products. Upgrade your subscription to add more.`,
            );
        }
    }

    async assertUserQuota(tenantId: string, additionalCount = 1) {
        const features = await this.getFeaturesForTenant(tenantId);
        const maxUsers = Number(features.maxUsers);
        if (!Number.isFinite(maxUsers) || maxUsers < 1) {
            return;
        }

        const [memberCount, pendingInviteCount] = await Promise.all([
            this.db.tenantUser.count({ where: { tenant_id: tenantId } }),
            this.db.userInvitation.count({
                where: {
                    tenant_id: tenantId,
                    accepted_at: null,
                    expires_at: { gt: new Date() },
                },
            }),
        ]);

        if (memberCount + pendingInviteCount + additionalCount > maxUsers) {
            throw new ForbiddenException(
                `Your plan allows up to ${maxUsers} team members. Upgrade your subscription to invite more users.`,
            );
        }
    }

    async assertEntitlement(tenantId: string, entitlementKey: string) {
        const features = await this.getFeaturesForTenant(tenantId);
        if (!hasPlanEntitlement(features, entitlementKey)) {
            throw new ForbiddenException(`This feature requires the plan entitlement: ${entitlementKey}.`);
        }
    }

    async assertStoreQuota(tenantId: string, additionalCount = 1) {
        const features = await this.getFeaturesForTenant(tenantId);
        const maxStores = Number(features.maxStores);
        if (!Number.isFinite(maxStores) || maxStores < 1) {
            return;
        }

        const currentCount = await this.db.store.count({
            where: { tenant_id: tenantId },
        });

        if (currentCount + additionalCount > maxStores) {
            throw new ForbiddenException(
                `Your plan allows up to ${maxStores} store locations. Upgrade your subscription to add more.`,
            );
        }
    }
}