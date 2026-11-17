import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformWorkspaceModule } from '../platform-workspace/platform-workspace.module';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { PlatformKpiController, TenantKpiController } from './kpi.controller';
import { MrrModule } from './mrr/mrr.module';
import { PlatformKpiService } from './platform-kpi.service';
import { TenantKpiService } from './tenant-kpi.service';

@Module({
    imports: [DatabaseModule, AccountingModule, PlatformSettingsModule, PlatformWorkspaceModule, MrrModule],
    controllers: [TenantKpiController, PlatformKpiController],
    providers: [TenantKpiService, PlatformKpiService, PlatformAdminGuard, StorePermissionGuard, SubscriptionAccessGuard],
    exports: [TenantKpiService, PlatformKpiService],
})
export class KpiModule {}
