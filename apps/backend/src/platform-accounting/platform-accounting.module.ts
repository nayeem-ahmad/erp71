import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformWorkspaceModule } from '../platform-workspace/platform-workspace.module';
import { PlatformAccountingController } from './platform-accounting.controller';
import { PlatformAccountingService } from './platform-accounting.service';

@Module({
    imports: [DatabaseModule, AccountingModule, PlatformSettingsModule, PlatformWorkspaceModule],
    controllers: [PlatformAccountingController],
    providers: [PlatformAccountingService],
    exports: [PlatformAccountingService],
})
export class PlatformAccountingModule {}
