import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
    controllers: [AdminDashboardController],
    providers: [AdminDashboardService, PlatformAdminGuard],
    exports: [AdminDashboardService],
})
export class AdminDashboardModule {}
