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

    /**
     * Members who exist only so an employee can open the self-service portal.
     *
     * They are real `TenantUser` rows — `EmployeeGuard` says so explicitly:
     * unlike a referee, an employee "is a real tenant member with a real
     * membership row". What keeps them out of the staff screens is that they are
     * provisioned with **no store permissions**, so `StorePermissionGuard`
     * refuses every guarded controller. This derives portal-only status from
     * exactly that invariant rather than a stored flag, so it cannot drift out of
     * sync with the thing the security model actually depends on: the moment
     * someone grants such a user a store permission they become staff, and the
     * next count bills for them.
     *
     * Without this, a 40-person shop that wants everyone to see a payslip needs
     * 30 extra seats — BDT 1,800/month on top of a BDT 999 plan — which nobody
     * decided and which makes "unlimited employee self-service" unsellable.
     *
     * Storefront customers never reach this code: their signup creates a `User`
     * and a `Customer` and no membership row at all.
     */
    private async countPortalOnlyMembers(tenantId: string): Promise<number> {
        const portalEmployees = await this.db.employee.findMany({
            where: {
                tenant_id: tenantId,
                portal_access: true,
                user_id: { not: null },
                deleted_at: null,
            },
            select: { user_id: true },
        });

        const userIds = portalEmployees
            .map((row) => row.user_id)
            .filter((id): id is string => Boolean(id));
        if (userIds.length === 0) return 0;

        const [staffPermissions, members] = await Promise.all([
            this.db.userStorePermission.findMany({
                where: { tenant_id: tenantId, user_id: { in: userIds } },
                select: { user_id: true },
                distinct: ['user_id'],
            }),
            this.db.tenantUser.findMany({
                where: { tenant_id: tenantId, user_id: { in: userIds } },
                select: { user_id: true, role: true },
            }),
        ]);

        const hasStorePermission = new Set(staffPermissions.map((row) => row.user_id));

        // An OWNER bypasses permission checks entirely, so an owner who also
        // holds a portal login is staff however few permission rows they have.
        return members.filter(
            (member) => member.role !== 'OWNER' && !hasStorePermission.has(member.user_id),
        ).length;
    }

    async assertUserQuota(tenantId: string, additionalCount = 1) {
        const features = await this.getFeaturesForTenant(tenantId);
        const maxUsers = Number(features.maxUsers);
        if (!Number.isFinite(maxUsers) || maxUsers < 1) {
            return;
        }

        const [memberCount, portalOnlyCount, pendingInviteCount] = await Promise.all([
            this.db.tenantUser.count({ where: { tenant_id: tenantId } }),
            this.countPortalOnlyMembers(tenantId),
            this.db.userInvitation.count({
                where: {
                    tenant_id: tenantId,
                    accepted_at: null,
                    expires_at: { gt: new Date() },
                },
            }),
        ]);

        const billableMembers = Math.max(0, memberCount - portalOnlyCount);

        if (billableMembers + pendingInviteCount + additionalCount > maxUsers) {
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