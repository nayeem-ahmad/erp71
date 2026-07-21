import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';

@Module({
    imports: [DatabaseModule],
    controllers: [SalesReportsController],
    providers: [SalesReportsService, SubscriptionAccessGuard, StorePermissionGuard],
    exports: [SalesReportsService],
})
export class SalesReportsModule {}
