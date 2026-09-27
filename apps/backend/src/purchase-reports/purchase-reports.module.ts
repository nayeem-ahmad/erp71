import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { PurchaseReportsController } from './purchase-reports.controller';
import { PurchaseReportsService } from './purchase-reports.service';
import { PurchaseLineItemsService } from './purchase-line-items.service';

@Module({
    imports: [DatabaseModule],
    controllers: [PurchaseReportsController],
    providers: [PurchaseReportsService, PurchaseLineItemsService, SubscriptionAccessGuard, TenantRoleGuard],
    exports: [PurchaseReportsService],
})
export class PurchaseReportsModule {}
