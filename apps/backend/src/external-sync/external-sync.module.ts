import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ExternalSyncController } from './external-sync.controller';
import { TenantExternalSyncController } from './tenant-external-sync.controller';
import { ExternalSyncScheduler } from './external-sync.scheduler';
import { ExternalSyncService } from './external-sync.service';

@Module({
    // PlatformSettingsModule supplies the per-tenant `externalImport` switch
    // that gates the tenant-facing controller.
    imports: [PlatformSettingsModule],
    controllers: [ExternalSyncController, TenantExternalSyncController],
    providers: [ExternalSyncService, ExternalSyncScheduler, PlatformAdminGuard],
    exports: [ExternalSyncService],
})
export class ExternalSyncModule {}
