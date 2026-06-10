import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { PurchaseReportsController } from './purchase-reports.controller';
import { PurchaseReportsService } from './purchase-reports.service';

@Module({
    imports: [DatabaseModule],
    controllers: [PurchaseReportsController],
    providers: [PurchaseReportsService, SubscriptionAccessGuard, TenantRoleGuard],
})
export class PurchaseReportsModule {}
