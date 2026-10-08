import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AlertPolicy } from './alert-policy';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationsService, AlertPolicy],
    exports: [NotificationsService, AlertPolicy],
})
export class NotificationsModule {}
