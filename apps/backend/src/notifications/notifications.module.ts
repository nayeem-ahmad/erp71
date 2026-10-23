import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { MemberPreferencesModule } from '../preferences/member-preferences.module';
import { AlertPolicy } from './alert-policy';

@Module({
    imports: [MemberPreferencesModule],
    controllers: [NotificationsController],
    providers: [NotificationsService, AlertPolicy],
    exports: [NotificationsService, AlertPolicy],
})
export class NotificationsModule {}
