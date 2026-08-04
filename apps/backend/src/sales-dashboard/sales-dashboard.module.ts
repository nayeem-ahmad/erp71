import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { SalesDashboardController } from './sales-dashboard.controller';
import { SalesDashboardService } from './sales-dashboard.service';

@Module({
    controllers: [SalesDashboardController],
    providers: [SalesDashboardService, StorePermissionGuard, SubscriptionAccessGuard],
    exports: [SalesDashboardService],
})
export class SalesDashboardModule {}
