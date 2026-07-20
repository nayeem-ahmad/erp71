import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatService } from './chat.service';
import { CustomersModule } from '../customers/customers.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InventoryReportsModule } from '../inventory-reports/inventory-reports.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ProductsModule } from '../products/products.module';
import { PurchaseReportsModule } from '../purchase-reports/purchase-reports.module';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';

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
        ExpensesModule,
    ],
    controllers: [AiController],
    providers: [AiService, ChatService],
    exports: [AiService, ChatService],
})
export class AiModule {}
