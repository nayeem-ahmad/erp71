import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { TransformInterceptor } from './common/transform.interceptor';
import { CommonModule } from './common/common.module';
import { CacheModule } from './cache/cache.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { InvitationsModule } from './invitations/invitations.module';
import { NotificationsModule } from './notifications/notifications.module';
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
import { AccountModule } from './account/account.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ContactModule } from './contact/contact.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { StorefrontModule } from './storefront/storefront.module';
import { TenantsModule } from './tenants/tenants.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { SmsModule } from './sms/sms.module';
import { DiscountCodesModule } from './discount-codes/discount-codes.module';
import { EmployeesModule } from './employees/employees.module';
import { CountersModule } from './counters/counters.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
    imports: [
        SentryModule.forRoot(),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
        ScheduleModule.forRoot(),
        CommonModule,
        CacheModule,
        DatabaseModule,
        EmailModule,
        SmsModule,
        AuditModule,
        HealthModule,
        AuthModule,
        PasswordResetModule,
        InvitationsModule,
        NotificationsModule,
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
        AccountModule,
        FeedbackModule,
        ContactModule,
        ApiKeysModule,
        StorefrontModule,
        TenantsModule,
        DeliveryModule,
        ManufacturingModule,
        LoyaltyModule,
        DiscountCodesModule,
        EmployeesModule,
        CountersModule,
        AttendanceModule,
    ],
    controllers: [],
    providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(CorrelationMiddleware).forRoutes('*');
    }
}

