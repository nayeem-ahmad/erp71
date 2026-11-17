import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { MrrModule } from '../kpis/mrr/mrr.module';

@Module({
    imports: [MrrModule],
    controllers: [AdminDashboardController],
    providers: [AdminDashboardService, PlatformAdminGuard],
    exports: [AdminDashboardService],
})
export class AdminDashboardModule {}
