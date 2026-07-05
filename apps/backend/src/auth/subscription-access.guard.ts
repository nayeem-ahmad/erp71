import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { hasPlanEntitlement, mergeAddonFeatures, normalizePlanFeatures, resolvePlanRank } from '@erp71/shared-types';
import {
    SUBSCRIPTION_EXTRA_FEATURES_KEY,
    SUBSCRIPTION_FEATURE_KEY,
    SUBSCRIPTION_PLAN_KEY,
} from './subscription-access.decorator';

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

const REQUIRED_PLAN_RANK: Record<'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM', number> = {
    FREE: 0,
    BASIC: 1,
    STANDARD: 2,
    PREMIUM: 3,
};

@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly db: DatabaseService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredPlan = this.reflector.getAllAndOverride<PlanCode | undefined>(SUBSCRIPTION_PLAN_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        const requiredFeature = this.reflector.getAllAndOverride<string | undefined>(SUBSCRIPTION_FEATURE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        const extraFeatures = this.reflector.getAllAndOverride<string[] | undefined>(SUBSCRIPTION_EXTRA_FEATURES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) ?? [];
        const requiredFeatures = [
            ...(requiredFeature ? [requiredFeature] : []),
            ...extraFeatures,
        ];

        if ((!requiredPlan || requiredPlan === 'FREE') && requiredFeatures.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const userId = request.user?.userId;
        const tenantIdHeader = request.headers['x-tenant-id'];
        const tenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;

        if (!userId || !tenantId) {
            throw new UnauthorizedException('Missing tenant context');
        }

        const membership = await this.db.tenantUser.findUnique({
            where: {
                tenant_id_user_id: {
                    tenant_id: tenantId,
                    user_id: userId,
                },
            },
        });

        if (!membership) {
            throw new UnauthorizedException('Invalid tenant context');
        }

        const activeAddonStatuses: Array<'ACTIVE' | 'TRIALING'> = ['ACTIVE', 'TRIALING'];
        const activeStatuses = new Set<string>(activeAddonStatuses);

        const [subscription, activeAddons] = await Promise.all([
            this.db.tenantSubscription.findUnique({
                where: { tenant_id: tenantId },
                include: { plan: true },
            }),
            this.db.tenantAddonSubscription.findMany({
                where: {
                    tenant_id: tenantId,
                    status: { in: activeAddonStatuses },
                    current_period_end: { gt: new Date() },
                },
                include: { addon: true },
            }),
        ]);

        const currentPlan = (subscription?.plan?.code ?? 'FREE') as PlanCode;
        const planFeatures = normalizePlanFeatures(
            subscription?.plan?.features_json as Record<string, unknown> | undefined,
            currentPlan,
        );
        // Add-ons only ever grant entitlements on top of the plan (see mergeAddonFeatures) —
        // they never affect plan rank, which stays plan-derived for @RequiresPlan checks.
        const features = mergeAddonFeatures(
            planFeatures,
            activeAddons.map((row) => row.addon.features_json as Record<string, unknown>),
        );
        const currentRank = resolvePlanRank(planFeatures, currentPlan);
        const hasRequiredPlan = requiredPlan
            ? currentRank >= REQUIRED_PLAN_RANK[requiredPlan]
            : true;
        const hasActiveSubscription = activeStatuses.has(subscription?.status);

        if (!hasActiveSubscription) {
            throw new ForbiddenException('This feature requires an active subscription.');
        }

        if (!hasRequiredPlan) {
            throw new ForbiddenException(`This feature requires an active ${requiredPlan} plan or higher.`);
        }

        for (const featureKey of requiredFeatures) {
            if (!hasPlanEntitlement(features, featureKey)) {
                throw new ForbiddenException(`This feature requires the plan entitlement: ${featureKey}.`);
            }
        }

        request.subscription = subscription;
        return true;
    }
}