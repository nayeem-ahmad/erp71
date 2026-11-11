import { Injectable } from '@nestjs/common';
import { AccountingService } from '../accounting/accounting.service';
import { CashierSessionsService } from '../cashier-sessions/cashier-sessions.service';
import { CustomersService } from '../customers/customers.service';
import { DailyReportService } from '../daily-report/daily-report.service';
import { ExpensesService } from '../expenses/expenses.service';
import { InventoryReportsService } from '../inventory-reports/inventory-reports.service';
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import { MushakService } from '../mushak/mushak.service';
import { PurchaseLineItemsService } from '../purchase-reports/purchase-line-items.service';
import { PurchaseReportsService } from '../purchase-reports/purchase-reports.service';
import { SalesLineItemsService } from '../sales-reports/sales-line-items.service';
import { SalesReportsService } from '../sales-reports/sales-reports.service';
import { StorefrontService } from '../storefront/storefront.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ChatDataService } from './chat-data.service';
import type { ChatToolDeps } from './chat-tools';
import { WebSearchService } from './web-search.service';

/**
 * The report services the data chatbot's tools call. Kept off ChatService so
 * adding a tool does not grow that constructor — ChatService owns the agent
 * loop, this owns the menu's backing services.
 */
@Injectable()
export class ChatToolDepsFactory {
    constructor(
        private readonly salesReports: SalesReportsService,
        private readonly inventoryReports: InventoryReportsService,
        private readonly purchaseReports: PurchaseReportsService,
        private readonly customers: CustomersService,
        private readonly suppliers: SuppliersService,
        private readonly expenses: ExpensesService,
        private readonly accounting: AccountingService,
        private readonly data: ChatDataService,
        private readonly web: WebSearchService,
        private readonly anomalies: AnomalyDetectionService,
        private readonly dailyReport: DailyReportService,
        private readonly cashierSessions: CashierSessionsService,
        private readonly salesLineItems: SalesLineItemsService,
        private readonly purchaseLineItems: PurchaseLineItemsService,
        private readonly mushak: MushakService,
        private readonly storefront: StorefrontService,
        private readonly manufacturing: ManufacturingService,
    ) {}

    build(): ChatToolDeps {
        return {
            salesReports: this.salesReports,
            inventoryReports: this.inventoryReports,
            purchaseReports: this.purchaseReports,
            customers: this.customers,
            suppliers: this.suppliers,
            expenses: this.expenses,
            accounting: this.accounting,
            data: this.data,
            web: this.web,
            anomalies: this.anomalies,
            dailyReport: this.dailyReport,
            cashierSessions: this.cashierSessions,
            salesLineItems: this.salesLineItems,
            purchaseLineItems: this.purchaseLineItems,
            mushak: this.mushak,
            storefront: this.storefront,
            manufacturing: this.manufacturing,
        };
    }
}
