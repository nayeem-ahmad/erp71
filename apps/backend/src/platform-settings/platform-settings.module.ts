import { Global, Module, forwardRef } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
    imports: [forwardRef(() => AiModule)],
    controllers: [PlatformSettingsController],
    providers: [PlatformSettingsService, PlatformAdminGuard],
    exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
