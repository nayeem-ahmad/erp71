import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ExternalSyncController } from './external-sync.controller';
import { ExternalSyncScheduler } from './external-sync.scheduler';
import { ExternalSyncService } from './external-sync.service';

@Module({
    controllers: [ExternalSyncController],
    providers: [ExternalSyncService, ExternalSyncScheduler, PlatformAdminGuard],
    exports: [ExternalSyncService],
})
export class ExternalSyncModule {}
