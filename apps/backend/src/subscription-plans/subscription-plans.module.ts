import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { SubscriptionPlansAdminController } from './subscription-plans-admin.controller';
import { PlanEntitlementsService } from './plan-entitlements.service';
import { SubscriptionPlansService } from './subscription-plans.service';

@Module({
    controllers: [SubscriptionPlansAdminController],
    providers: [SubscriptionPlansService, PlanEntitlementsService, PlatformAdminGuard],
    exports: [SubscriptionPlansService, PlanEntitlementsService],
})
export class SubscriptionPlansModule {}