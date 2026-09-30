import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { CashierSessionsModule } from '../cashier-sessions/cashier-sessions.module';
import { PurchaseReportsModule } from '../purchase-reports/purchase-reports.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { AccountingModule } from '../accounting/accounting.module';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';

@Module({
    imports: [
        DatabaseModule,
        SalesReportsModule,
        CashierSessionsModule,
        PurchaseReportsModule,
        ExpensesModule,
        AccountingModule,
    ],
    controllers: [DailyReportController],
    providers: [DailyReportService, SubscriptionAccessGuard, StorePermissionGuard],
})
export class DailyReportModule {}
