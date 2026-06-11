import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Global()
@Module({
    controllers: [PlatformSettingsController],
    providers: [PlatformSettingsService, PlatformAdminGuard],
    exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
