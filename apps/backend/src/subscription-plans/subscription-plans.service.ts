import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    FixedSubscriptionPlanCode,
    normalizePlanFeatures,
    parseMarketingFeatures,
    parsePlanFeatures,
    SUBSCRIPTION_PLAN_CODES,
} from '@erp71/shared-types';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { UpdateSubscriptionPlanDto } from './subscription-plans.dto';

@Injectable()
export class SubscriptionPlansService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    async listPlans() {
        const plans = await this.db.subscriptionPlan.findMany({
            orderBy: { monthly_price: 'asc' },
            include: {
                _count: {
                    select: { subscriptions: true },
                },
            },
        });

        return {
            plans: plans.map((plan) => this.mapPlan(plan)),
            codes: [...SUBSCRIPTION_PLAN_CODES],
        };
    }

    async getPlan(code: FixedSubscriptionPlanCode) {
        const plan = await this.findPlanOrThrow(code);
        return this.mapPlan(plan);
    }

    async updatePlan(
        code: FixedSubscriptionPlanCode,
        dto: UpdateSubscriptionPlanDto,
        userId: string,
    ) {
        const existing = await this.findPlanOrThrow(code);
        this.assertUpdateAllowed(code, dto);

        const featuresJson = parsePlanFeatures(dto.features, code);
        const marketingFeatures = parseMarketingFeatures(dto.marketing_features ?? []);

        const updated = await this.db.subscriptionPlan.update({
            where: { code },
            data: {
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                monthly_price: dto.monthly_price,
                yearly_price: dto.yearly_price ?? null,
                is_active: dto.is_active,
                features_json: featuresJson,
                marketing_features_json: marketingFeatures,
            },
            include: {
                _count: {
                    select: { subscriptions: true },
                },
            },
        });

        await this.audit.log(
            'subscription_plan.update',
            'subscription_plan',
            { userId },
            code,
            {
                before: {
                    name: existing.name,
                    description: existing.description,
                    monthly_price: Number(existing.monthly_price),
                    yearly_price: existing.yearly_price === null ? null : Number(existing.yearly_price),
                    is_active: existing.is_active,
                    features_json: normalizePlanFeatures(existing.features_json as Record<string, unknown>, code),
                    marketing_features: parseMarketingFeatures(existing.marketing_features_json),
                },
                after: {
                    name: updated.name,
                    description: updated.description,
                    monthly_price: Number(updated.monthly_price),
                    yearly_price: updated.yearly_price === null ? null : Number(updated.yearly_price),
                    is_active: updated.is_active,
                    features_json: featuresJson,
                    marketing_features: marketingFeatures,
                },
            },
        );

        return this.mapPlan(updated);
    }

    private async findPlanOrThrow(code: FixedSubscriptionPlanCode) {
        const plan = await this.db.subscriptionPlan.findUnique({
            where: { code },
            include: {
                _count: {
                    select: { subscriptions: true },
                },
            },
        });

        if (!plan) {
            throw new NotFoundException(`Subscription plan "${code}" was not found.`);
        }

        return plan;
    }

    private assertUpdateAllowed(code: FixedSubscriptionPlanCode, dto: UpdateSubscriptionPlanDto) {
        if (code === 'FREE' && (dto.monthly_price !== 0 || (dto.yearly_price ?? 0) !== 0)) {
            throw new BadRequestException('The FREE plan must have zero pricing.');
        }

        if (dto.monthly_price < 0) {
            throw new BadRequestException('Monthly price cannot be negative.');
        }

        if (dto.yearly_price != null && dto.yearly_price < 0) {
            throw new BadRequestException('Yearly price cannot be negative.');
        }
    }

    private mapPlan(plan: {
        code: string;
        name: string;
        description: string | null;
        monthly_price: unknown;
        yearly_price: unknown;
        features_json: unknown;
        marketing_features_json?: unknown;
        is_active: boolean;
        _count?: { subscriptions: number };
    }) {
        return {
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthly_price: Number(plan.monthly_price),
            yearly_price: plan.yearly_price === null ? null : Number(plan.yearly_price),
            features_json: normalizePlanFeatures(plan.features_json as Record<string, unknown>, plan.code),
            marketing_features: parseMarketingFeatures(plan.marketing_features_json),
            is_active: plan.is_active,
            subscriber_count: plan._count?.subscriptions ?? 0,
        };
    }
}