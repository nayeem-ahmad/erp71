import { Body, Controller, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import {
    FixedSubscriptionPlanCode,
    PLAN_ENTITLEMENT_REGISTRY,
    SUBSCRIPTION_PLAN_CODES,
} from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { UpdateSubscriptionPlanDto } from './subscription-plans.dto';
import { SubscriptionPlansService } from './subscription-plans.service';

@Controller('admin/subscription-plans')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SubscriptionPlansAdminController {
    constructor(private readonly subscriptionPlans: SubscriptionPlansService) {}

    @Get('registry')
    getRegistry() {
        return {
            codes: [...SUBSCRIPTION_PLAN_CODES],
            entitlements: PLAN_ENTITLEMENT_REGISTRY,
        };
    }

    @Get()
    listPlans() {
        return this.subscriptionPlans.listPlans();
    }

    @Get(':code')
    getPlan(@Param('code') code: FixedSubscriptionPlanCode) {
        return this.subscriptionPlans.getPlan(code);
    }

    @Put(':code')
    updatePlan(
        @Param('code') code: FixedSubscriptionPlanCode,
        @Body() dto: UpdateSubscriptionPlanDto,
        @Request() req: { user: { userId: string } },
    ) {
        return this.subscriptionPlans.updatePlan(code, dto, req.user.userId);
    }
}