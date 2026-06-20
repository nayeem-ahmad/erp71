import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { SUBSCRIPTION_FEATURE_KEY, SUBSCRIPTION_PLAN_KEY } from './subscription-access.decorator';

type PlanCode = 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

const PLAN_RANK: Record<PlanCode, number> = {
    FREE: 0,
    // ACCOUNTING is a specialised pack, not a tier on the FREE→PREMIUM ladder.
    // It is gated by the `premiumAccounting` feature flag (and ungated funds
    // modules), so it sits at FREE rank to avoid unlocking any `@RequiresPlan`
    // (BASIC/STANDARD) routes outside the accounting scope.
    ACCOUNTING: 0,
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

        if ((!requiredPlan || requiredPlan === 'FREE') && !requiredFeature) {
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
        const hasRequiredPlan = requiredPlan ? PLAN_RANK[currentPlan] >= PLAN_RANK[requiredPlan] : true;
        const hasActiveSubscription = activeStatuses.has(subscription?.status);

        if (!hasActiveSubscription) {
            throw new ForbiddenException('This feature requires an active subscription.');
        }

        if (!hasRequiredPlan) {
            throw new ForbiddenException(`This feature requires an active ${requiredPlan} plan or higher.`);
        }

        if (requiredFeature) {
            const featureValue = (subscription?.plan?.features_json as Record<string, unknown> | undefined)?.[requiredFeature];
            const hasRequiredFeature = this.isFeatureEnabled(featureValue);

            if (!hasRequiredFeature) {
                throw new ForbiddenException(`This feature requires the plan entitlement: ${requiredFeature}.`);
            }
        }

        request.subscription = subscription;
        return true;
    }

    private isFeatureEnabled(value: unknown): boolean {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value > 0;
        }
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        return false;
    }
}