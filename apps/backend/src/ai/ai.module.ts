import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
    imports: [forwardRef(() => PlatformSettingsModule)],
    controllers: [AiController],
    providers: [AiService],
    exports: [AiService],
})
export class AiModule {}
