import { Module } from '@nestjs/common';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { PurchaseDashboardController } from './purchase-dashboard.controller';
import { PurchaseDashboardService } from './purchase-dashboard.service';

@Module({
    controllers: [PurchaseDashboardController],
    providers: [PurchaseDashboardService, TenantRoleGuard, SubscriptionAccessGuard],
    exports: [PurchaseDashboardService],
})
export class PurchaseDashboardModule {}
