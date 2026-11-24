import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SalesModule } from '../sales/sales.module';
import { PaymentProviderCatalogService } from './payment-provider-catalog.service';
import { StorefrontOrderBillingService } from './storefront-order-billing.service';
import { StorefrontPaymentService } from './storefront-payment.service';
import { StorefrontPaymentProvidersController } from './storefront-payment-providers.controller';
import { TenantPaymentGatewaysController } from './tenant-payment-gateways.controller';
import { StorefrontPaymentController } from './storefront-payment.controller';

/**
 * Storefront online payments: the platform's provider catalog, each shop's own
 * merchant account, and the public session/callback endpoints.
 */
@Module({
    imports: [DatabaseModule, SalesModule],
    controllers: [
        StorefrontPaymentProvidersController,
        TenantPaymentGatewaysController,
        StorefrontPaymentController,
    ],
    providers: [PaymentProviderCatalogService, StorefrontPaymentService, StorefrontOrderBillingService],
    exports: [PaymentProviderCatalogService, StorefrontPaymentService, StorefrontOrderBillingService],
})
export class StorefrontPaymentsModule {}
