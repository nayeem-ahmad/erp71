import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShortLinksModule } from '../short-links/short-links.module';
import { MeetingRemindersService } from './meeting-reminders.service';
import { MeetingActionsController, MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { PublicMeetingsController } from './public-meetings.controller';

@Module({
    imports: [DatabaseModule, NotificationsModule, ShortLinksModule],
    controllers: [MeetingsController, MeetingActionsController, PublicMeetingsController],
    providers: [MeetingsService, MeetingRemindersService],
    exports: [MeetingsService],
})
export class MeetingsModule {}
