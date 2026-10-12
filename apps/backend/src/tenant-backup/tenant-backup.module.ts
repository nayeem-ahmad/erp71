import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantBackupController } from './admin-tenant-backup.controller';
import { TenantBackupService } from './tenant-backup.service';

@Module({
    controllers: [AdminTenantBackupController],
    providers: [TenantBackupService, PlatformAdminGuard],
    exports: [TenantBackupService],
})
export class TenantBackupModule {}
