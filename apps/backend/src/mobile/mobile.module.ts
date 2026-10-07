import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { SalesDashboardModule } from '../sales-dashboard/sales-dashboard.module';
import { MobileController } from './mobile.controller';
import { MobilePulseService } from './mobile-pulse.service';

@Module({
    imports: [SalesDashboardModule],
    controllers: [MobileController],
    providers: [MobilePulseService, StorePermissionGuard, SubscriptionAccessGuard],
})
export class MobileModule {}
