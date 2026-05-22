import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { FeedbackController } from './feedback.controller';

@Module({
    imports: [DatabaseModule, EmailModule],
    controllers: [FeedbackController],
})
export class FeedbackModule {}
