import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PreferencesModule } from '../preferences/preferences.module';
import { AlertPolicy } from './alert-policy';

@Module({
    imports: [PreferencesModule],
    controllers: [NotificationsController],
    providers: [NotificationsService, AlertPolicy],
    exports: [NotificationsService, AlertPolicy],
})
export class NotificationsModule {}
