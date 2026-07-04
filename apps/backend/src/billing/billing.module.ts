import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';

@Module({
    imports: [NotificationsModule],
    controllers: [BillingController],
    providers: [BillingService, BillingSchedulerService],
    exports: [BillingService],
})
export class BillingModule {}