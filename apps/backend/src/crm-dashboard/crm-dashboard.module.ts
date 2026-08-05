import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { CrmDashboardController } from './crm-dashboard.controller';
import { CrmDashboardService } from './crm-dashboard.service';

@Module({
    controllers: [CrmDashboardController],
    providers: [CrmDashboardService, StorePermissionGuard, SubscriptionAccessGuard],
    exports: [CrmDashboardService],
})
export class CrmDashboardModule {}
