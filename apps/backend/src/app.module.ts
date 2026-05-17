import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { CsrfMiddleware } from './common/csrf.middleware';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { AssetsModule } from './assets/assets.module';
import { SalesModule } from './sales/sales.module';
import { CustomersModule } from './customers/customers.module';
import { CustomerGroupsModule } from './customer-groups/customer-groups.module';
import { TerritoriesModule } from './territories/territories.module';
import { SalesReturnsModule } from './sales-returns/sales-returns.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { SalesQuotationsModule } from './sales-quotations/sales-quotations.module';
import { CashierSessionsModule } from './cashier-sessions/cashier-sessions.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PurchaseReturnsModule } from './purchase-returns/purchase-returns.module';
import { AccountingModule } from './accounting/accounting.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ProductGroupsModule } from './product-groups/product-groups.module';
import { ProductSubgroupsModule } from './product-subgroups/product-subgroups.module';
import { InventoryModule } from './inventory/inventory.module';
import { WarehouseTransfersModule } from './warehouse-transfers/warehouse-transfers.module';
import { InventoryShrinkageModule } from './inventory-shrinkage/inventory-shrinkage.module';
import { StockTakesModule } from './stock-takes/stock-takes.module';
import { InventoryReportsModule } from './inventory-reports/inventory-reports.module';
import { SalesReportsModule } from './sales-reports/sales-reports.module';
import { BillingModule } from './billing/billing.module';
import { AdminTenantsModule } from './admin-tenants/admin-tenants.module';
import { WarrantyClaimsModule } from './warranty-claims/warranty-claims.module';
import { HealthModule } from './health/health.module';
import { EmailModule } from './email/email.module';

@Module({
    imports: [
        ThrottlerModule.forRoot([
            {
                name: 'default',
                ttl: 60_000,
                limit: 300,
            },
        ]),
        LoggerModule.forRoot({
            pinoHttp: {
                level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
                transport: process.env.NODE_ENV !== 'production'
                    ? { target: 'pino-pretty', options: { singleLine: true } }
                    : undefined,
                redact: ['req.headers.authorization'],
            },
        }),
        DatabaseModule,
        AuthModule,
        ProductsModule,
        AssetsModule,
        SalesModule,
        CustomersModule,
        CustomerGroupsModule,
        TerritoriesModule,
        SalesReturnsModule,
        SalesOrdersModule,
        SalesQuotationsModule,
        CashierSessionsModule,
        SuppliersModule,
        PurchasesModule,
        PurchaseReturnsModule,
        AccountingModule,
        ProductGroupsModule,
        ProductSubgroupsModule,
        InventoryModule,
        WarehouseTransfersModule,
        InventoryShrinkageModule,
        StockTakesModule,
        InventoryReportsModule,
        SalesReportsModule,
        BillingModule,
        AdminTenantsModule,
        WarrantyClaimsModule,
        HealthModule,
        EmailModule,
        ScheduleModule.forRoot()
    ],
    controllers: [],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestIdMiddleware, CsrfMiddleware).forRoutes('*path');
    }
}
