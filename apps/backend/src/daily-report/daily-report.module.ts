import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { CashierSessionsModule } from '../cashier-sessions/cashier-sessions.module';
import { PurchaseReportsModule } from '../purchase-reports/purchase-reports.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { AccountingModule } from '../accounting/accounting.module';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { DailySummaryEmailService } from './daily-summary-email.service';
import { DailySummarySmsService } from './daily-summary-sms.service';

@Module({
    imports: [
        DatabaseModule,
        CashierSessionsModule,
        PurchaseReportsModule,
        ExpensesModule,
        AccountingModule,
    ],
    controllers: [DailyReportController],
    providers: [DailyReportService, DailySummaryEmailService, DailySummarySmsService, SubscriptionAccessGuard, StorePermissionGuard],
})
export class DailyReportModule {}
