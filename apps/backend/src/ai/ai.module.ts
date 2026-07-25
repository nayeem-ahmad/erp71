import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatDataService } from './chat-data.service';
import { ChatService } from './chat.service';
import { WebSearchService } from './web-search.service';
import { AccountingModule } from '../accounting/accounting.module';
import { CustomersModule } from '../customers/customers.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InventoryReportsModule } from '../inventory-reports/inventory-reports.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ProductsModule } from '../products/products.module';
import { PurchaseReportsModule } from '../purchase-reports/purchase-reports.module';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

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
    ],
    controllers: [AiController],
    // ChatDataService is provided here rather than imported: it is the chatbot's
    // own read-only query layer, not a shared domain service, and nothing outside
    // the assistant should be reaching for it.
    providers: [AiService, ChatService, ChatDataService, WebSearchService],
    exports: [AiService, ChatService],
})
export class AiModule {}
