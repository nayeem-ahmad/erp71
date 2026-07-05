import { Global, Module, forwardRef } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformFeatureGuard } from './platform-feature.guard';
import { AiModule } from '../ai/ai.module';

@Global()
@Module({
    imports: [forwardRef(() => AiModule)],
    controllers: [PlatformSettingsController],
    providers: [PlatformSettingsService, PlatformAdminGuard, PlatformFeatureGuard],
    exports: [PlatformSettingsService, PlatformFeatureGuard],
})
export class PlatformSettingsModule {}
