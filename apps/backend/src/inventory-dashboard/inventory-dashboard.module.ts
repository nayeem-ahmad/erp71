import { Module } from '@nestjs/common';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { InventoryDashboardController } from './inventory-dashboard.controller';
import { InventoryDashboardService } from './inventory-dashboard.service';

@Module({
    imports: [SubscriptionPlansModule],
    controllers: [InventoryDashboardController],
    providers: [InventoryDashboardService],
    exports: [InventoryDashboardService],
})
export class InventoryDashboardModule {}
