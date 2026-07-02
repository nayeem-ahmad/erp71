import { ForbiddenException, Injectable } from '@nestjs/common';
import { hasPlanEntitlement, normalizePlanFeatures } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class PlanEntitlementsService {
    constructor(private readonly db: DatabaseService) {}

    async getFeaturesForTenant(tenantId: string) {
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        return normalizePlanFeatures(
            subscription?.plan?.features_json as Record<string, unknown> | undefined,
            subscription?.plan?.code ?? 'FREE',
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