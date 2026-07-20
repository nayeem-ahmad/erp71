import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { InventoryReportsController } from './inventory-reports.controller';
import { InventoryReportsService } from './inventory-reports.service';

@Module({
    imports: [DatabaseModule],
    controllers: [InventoryReportsController],
    providers: [InventoryReportsService, SubscriptionAccessGuard],
    exports: [InventoryReportsService],
})
export class InventoryReportsModule {}