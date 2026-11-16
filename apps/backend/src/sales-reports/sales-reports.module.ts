import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { SalesLineItemsService } from './sales-line-items.service';
import { ColdCustomersService } from './cold-customers.service';

@Module({
    imports: [DatabaseModule],
    controllers: [SalesReportsController],
    providers: [
        SalesReportsService,
        SalesLineItemsService,
        ColdCustomersService,
        SubscriptionAccessGuard,
        StorePermissionGuard,
    ],
    exports: [SalesReportsService, SalesLineItemsService, ColdCustomersService],
})
export class SalesReportsModule {}
