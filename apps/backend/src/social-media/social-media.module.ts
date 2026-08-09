import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SocialMediaService } from './social-media.service';
import { SocialMediaAdminController } from './social-media-admin.controller';
import { BufferService } from './buffer.service';

// PlatformSettingsModule is @Global, so BufferService gets it without an import
// here — listing it would create a cycle through the settings controller.
@Module({
    imports: [DatabaseModule],
    controllers: [SocialMediaAdminController],
    providers: [SocialMediaService, BufferService],
    exports: [SocialMediaService, BufferService],
})
export class SocialMediaModule {}
