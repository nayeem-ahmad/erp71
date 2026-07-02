import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { hasPlanEntitlement, normalizePlanFeatures, resolvePlanRank } from '@erp71/shared-types';
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

        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        const activeStatuses = new Set(['ACTIVE', 'TRIALING']);
        const currentPlan = (subscription?.plan?.code ?? 'FREE') as PlanCode;
        const features = normalizePlanFeatures(
            subscription?.plan?.features_json as Record<string, unknown> | undefined,
            currentPlan,
        );
        const currentRank = resolvePlanRank(features, currentPlan);
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