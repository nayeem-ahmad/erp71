import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ChatDataService } from './chat-data.service';
import { ChatService } from './chat.service';
import { ChatToolDepsFactory } from './chat-tool-deps.factory';
import { WebSearchService } from './web-search.service';
import { AccountingModule } from '../accounting/accounting.module';
import { CashierSessionsModule } from '../cashier-sessions/cashier-sessions.module';
import { CrmCampaignsModule } from '../crm-campaigns/crm-campaigns.module';
import { CrmFollowUpsModule } from '../crm-follow-ups/crm-follow-ups.module';
import { CrmLeadsModule } from '../crm-leads/crm-leads.module';
import { CustomersModule } from '../customers/customers.module';
import { DailyReportModule } from '../daily-report/daily-report.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ImportsModule } from '../imports/imports.module';
import { InventoryReportsModule } from '../inventory-reports/inventory-reports.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { MushakModule } from '../mushak/mushak.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ProductsModule } from '../products/products.module';
import { PurchaseReportsModule } from '../purchase-reports/purchase-reports.module';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { StorefrontPagesModule } from '../storefront-pages/storefront-pages.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CrmContactsModule } from '../crm-contacts/crm-contacts.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { HrReportsModule } from '../hr-reports/hr-reports.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';

@Module({
    imports: [
        forwardRef(() => PlatformSettingsModule),
        ProductsModule,
        SubscriptionPlansModule,
        // Report services backing the data chatbot's tools. Importing the modules
        // (rather than re-providing the services) keeps one instance per service,
        // so the chatbot answers from exactly the same code path as the REST API.
        SalesReportsModule,
        InventoryReportsModule,
        PurchaseReportsModule,
        CustomersModule,
        SuppliersModule,
        ExpensesModule,
        AccountingModule,
        DailyReportModule,
        CashierSessionsModule,
        MushakModule,
        // These three import AuthModule, and AuthModule → PlatformSettings → AiModule.
        // Loading them while AuthModule is still evaluating leaves their Auth import
        // undefined unless both sides of the cycle are deferred.
        forwardRef(() => StorefrontModule),
        forwardRef(() => ManufacturingModule),
        forwardRef(() => ImportsModule),
        StorefrontPagesModule,
        CrmLeadsModule,
        CrmCampaignsModule,
        CrmFollowUpsModule,
        // CrmContactsModule imports AiModule for the business-card scanner.
        forwardRef(() => CrmContactsModule),
        ApprovalsModule,
        HrReportsModule,
        PayrollModule,
        RecruitmentModule,
    ],
    controllers: [AiController],
    // ChatDataService is provided here rather than imported: it is the chatbot's
    // own read-only query layer, not a shared domain service, and nothing outside
    // the assistant should be reaching for it.
    // AnomalyDetectionService is exported as well: it takes a tenant id and a
    // window and returns a ranked list, which is exactly what the planned weekly
    // scan needs, and that job has no business going through the chat loop.
    providers: [AiService, ChatService, ChatToolDepsFactory, ChatDataService, WebSearchService, AnomalyDetectionService],
    exports: [AiService, ChatService, AnomalyDetectionService, WebSearchService],
})
export class AiModule {}
