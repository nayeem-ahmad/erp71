import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { HrDashboardController } from './hr-dashboard.controller';
import { HrDashboardService } from './hr-dashboard.service';

@Module({
    controllers: [HrDashboardController],
    providers: [HrDashboardService, StorePermissionGuard],
    exports: [HrDashboardService],
})
export class HrDashboardModule {}
