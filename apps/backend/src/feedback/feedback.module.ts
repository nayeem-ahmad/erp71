import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { SupportModule } from '../support/support.module';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';

@Module({
    imports: [DatabaseModule, EmailModule, PlatformSettingsModule, SupportModule],
    controllers: [FeedbackController, AdminFeedbackController],
})
export class FeedbackModule {}
