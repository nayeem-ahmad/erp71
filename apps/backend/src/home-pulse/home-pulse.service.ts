import { Injectable, Logger } from '@nestjs/common';
import { hasPlanEntitlement, StorePermission as P, type PlatformFeatures } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { BranchScopeService } from '../database/branch-scope.service';
import { loadMemberStoreGrants, type MemberStoreGrants } from '../database/member-access.loader';
import type { TenantContext } from '../database/tenant.decorator';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ProductsService } from '../products/products.service';
import { AccountingService } from '../accounting/accounting.service';
import { CrmActivitiesService } from '../crm-activities/crm-activities.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { RedisService } from '../cache/redis.service';
import {
    CATALOG_READ,
    HR_READ,
    MANUFACTURING_READ,
    PURCHASE_READ,
    SALES_READ,
    STOREFRONT_STAFF,
} from '../auth/permission-sets';

/** One app's tile line: how much is waiting, and where it is. */
export interface PulseEntry {
    count: number;
    href: string;
}

export type HomePulse = Record<string, PulseEntry>;

interface Metric {
    app: string;
    href: string;
    /** The member needs one of these, as the metric's own page does. */
    permissions: readonly P[];
    entitlement?: string;
    platformFeature?: keyof PlatformFeatures;
    /** Counted for one branch (or all, for whoever may see all) — the branch rule decides. */
    branchScoped?: boolean;
    count: (tenant: TenantContext, storeId: string | undefined) => Promise<number>;
}

const CACHE_SECONDS = 60;

/**
 * The Home tiles' one request: a count per app of the work waiting in it.
 *
 * Each metric is gated the way its own page is — plan, platform switch,
 * permission, branch — and computed on its own, so a member who can open one
 * module gets that module's count, and a metric that fails is simply missing
 * rather than taking the others down with it. Nothing here is refused as a
 * whole; that is why the controller carries no permission guard.
 */
@Injectable()
export class HomePulseService {
    private readonly logger = new Logger(HomePulseService.name);
    private readonly metrics: Metric[];

    constructor(
        private readonly db: DatabaseService,
        private readonly authCache: AuthCacheService,
        private readonly branchScope: BranchScopeService,
        private readonly entitlements: PlanEntitlementsService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly products: ProductsService,
        private readonly accounting: AccountingService,
        private readonly crm: CrmActivitiesService,
        private readonly projectAccess: ProjectAccessService,
        private readonly redis: RedisService,
    ) {
        this.metrics = this.defineMetrics();
    }

    async getPulse(tenant: TenantContext, requestedStoreId: string | undefined): Promise<HomePulse> {
        // Per member: the result depends on what they hold, and the projects
        // count is their own tasks. Per branch too — with none asked for, the
        // header branch decides, so it has to be in the key.
        const branchKey = requestedStoreId ?? `header-${tenant.storeId ?? 'none'}`;
        const cacheKey = `home:pulse:${tenant.tenantId}:${tenant.userId}:${branchKey}`;
        const cached = await this.redis.get<HomePulse>(cacheKey);
        if (cached) return cached;

        const [features, grants] = await Promise.all([
            this.entitlements.getFeaturesForTenant(tenant.tenantId),
            tenant.userRole === 'OWNER'
                ? Promise.resolve(null)
                : loadMemberStoreGrants(this.db, this.authCache, tenant.userId, tenant.tenantId),
        ]);

        const entries = await Promise.all(
            this.metrics.map((metric) => this.measure(metric, tenant, requestedStoreId, features, grants)),
        );

        const pulse: HomePulse = {};
        for (const entry of entries) {
            if (entry) pulse[entry.app] = { count: entry.count, href: entry.href };
        }

        await this.redis.set(cacheKey, pulse, CACHE_SECONDS);
        return pulse;
    }

    private async measure(
        metric: Metric,
        tenant: TenantContext,
        requestedStoreId: string | undefined,
        features: Record<string, boolean | number>,
        grants: MemberStoreGrants | null,
    ): Promise<{ app: string; count: number; href: string } | null> {
        try {
            if (metric.entitlement && !hasPlanEntitlement(features, metric.entitlement)) return null;
            if (
                metric.platformFeature
                && !(await this.platformSettings.isFeatureEnabledForTenant(metric.platformFeature, tenant.tenantId))
            ) {
                return null;
            }

            let storeId: string | undefined;
            if (metric.branchScoped) {
                // Throws for a branch the member may not read; caught below.
                storeId = await this.branchScope.resolveStoreId(tenant, requestedStoreId, {
                    permissions: metric.permissions,
                });
            }
            // `resolveStoreId` only checks permissions for an explicitly
            // requested branch, so the member's grants are checked here too —
            // in the resolved branch, or (tenant-wide) the header branch.
            if (!holdsAny(grants, metric.permissions, metric.branchScoped ? storeId : tenant.storeId)) return null;

            const count = await metric.count(tenant, storeId);
            return count > 0 ? { app: metric.app, count, href: metric.href } : null;
        } catch (error) {
            // Refused (branch rule) or broken (query): either way this tile
            // goes without a count, and the rest of Home is unaffected.
            this.logger.debug(`pulse ${metric.app} skipped: ${(error as Error).message}`);
            return null;
        }
    }

    private defineMetrics(): Metric[] {
        return [
            {
                app: 'sales',
                href: '/sales/orders',
                permissions: SALES_READ,
                branchScoped: true,
                count: (tenant, storeId) => this.db.salesOrder.count({
                    where: {
                        tenant_id: tenant.tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        status: { in: ['CONFIRMED', 'PROCESSING'] },
                    },
                }),
            },
            {
                app: 'inventory',
                // The inventory overview, as the retail dashboard's low-stock
                // tile does: the reorder report is a premium report most of
                // the members counted here cannot open.
                href: '/inventory',
                permissions: CATALOG_READ,
                branchScoped: true,
                count: async (tenant, storeId) => (await this.products.countLowStock(tenant.tenantId, storeId)).count,
            },
            {
                app: 'accounting',
                href: '/accounting/vouchers?approvalStatus=PENDING',
                permissions: [P.VIEW_LEDGER],
                entitlement: 'premiumAccounting',
                count: async (tenant) => (await this.accounting.getPendingVoucherCount(tenant.tenantId)).count,
            },
            {
                app: 'crm',
                href: '/crm/activities',
                permissions: [P.VIEW_CRM_INTERACTIONS],
                entitlement: 'premiumCrm',
                // The whole team's, as the activities page opens by default.
                count: async (tenant) => {
                    const summary = await this.crm.summary(tenant.tenantId, tenant.timezone);
                    return summary.dueToday + summary.overdue;
                },
            },
            {
                app: 'projects',
                href: '/projects/tasks',
                permissions: [P.VIEW_PROJECTS],
                platformFeature: 'projects',
                // The tasks page opens on "assigned to me"; private projects stay
                // out through the same filter its list applies.
                count: async (tenant) => this.db.projectTask.count({
                    where: {
                        AND: [
                            {
                                tenant_id: tenant.tenantId,
                                deleted_at: null,
                                assignee_id: tenant.userId,
                                status: { category: { not: 'DONE' } },
                            },
                            await this.projectAccess.taskFilter(tenant),
                        ],
                    },
                }),
            },
            {
                app: 'hr',
                href: '/hr/leaves',
                permissions: HR_READ,
                count: (tenant) => this.db.leaveRequest.count({
                    where: { tenant_id: tenant.tenantId, status: 'PENDING', deleted_at: null },
                }),
            },
            {
                app: 'purchase',
                href: '/purchases/orders',
                permissions: PURCHASE_READ,
                branchScoped: true,
                count: (tenant, storeId) => this.db.purchaseOrder.count({
                    where: {
                        tenant_id: tenant.tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        status: { in: ['DRAFT', 'SENT'] },
                        received_at: null,
                    },
                }),
            },
            {
                app: 'storefront',
                href: '/storefront',
                permissions: STOREFRONT_STAFF,
                count: (tenant) => this.db.storefrontOrder.count({
                    where: { tenantId: tenant.tenantId, status: 'PENDING' },
                }),
            },
            {
                app: 'manufacturing',
                href: '/manufacturing/jobs',
                permissions: MANUFACTURING_READ,
                entitlement: 'premiumManufacturing',
                platformFeature: 'manufacturing',
                count: (tenant) => this.db.productionJob.count({
                    where: { tenantId: tenant.tenantId, status: 'IN_PROGRESS' },
                }),
            },
            {
                app: 'imports',
                href: '/purchases/imports',
                permissions: [P.VIEW_IMPORTS, P.MANAGE_IMPORTS],
                branchScoped: true,
                count: (tenant, storeId) => this.db.importShipment.count({
                    where: {
                        tenant_id: tenant.tenantId,
                        ...(storeId ? { store_id: storeId } : {}),
                        status: { notIn: ['RECEIVED', 'CLOSED', 'CANCELLED'] },
                    },
                }),
            },
        ];
    }
}

/**
 * Owner (`grants === null`) holds everything. Otherwise the member needs one of
 * the permissions in `storeId`, or in any branch when there is none to ask about.
 */
function holdsAny(grants: MemberStoreGrants | null, permissions: readonly string[], storeId: string | undefined): boolean {
    if (grants === null) return true;
    if (storeId) {
        const held = grants.get(storeId);
        return Boolean(held) && permissions.some((permission) => held!.has(permission));
    }
    for (const held of grants.values()) {
        if (permissions.some((permission) => held.has(permission))) return true;
    }
    return false;
}
