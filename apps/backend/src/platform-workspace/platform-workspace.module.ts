import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformWorkspaceController } from './platform-workspace.controller';
import { PlatformWorkspaceService } from './platform-workspace.service';

@Module({
    imports: [DatabaseModule, PlatformSettingsModule],
    controllers: [PlatformWorkspaceController],
    providers: [PlatformWorkspaceService],
    exports: [PlatformWorkspaceService],
})
export class PlatformWorkspaceModule {}
