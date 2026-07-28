import { Module } from '@nestjs/common';
import { CrmFollowUpsController } from './crm-follow-ups.controller';
import { CrmFollowUpsService } from './crm-follow-ups.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [DatabaseModule, NotificationsModule],
    controllers: [CrmFollowUpsController],
    providers: [CrmFollowUpsService],
    exports: [CrmFollowUpsService],
})
export class CrmFollowUpsModule {}
