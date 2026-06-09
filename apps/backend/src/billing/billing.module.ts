import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingSchedulerService } from './billing-scheduler.service';

@Module({
    controllers: [BillingController],
    providers: [BillingService, BillingSchedulerService],
    exports: [BillingService],
})
export class BillingModule {}