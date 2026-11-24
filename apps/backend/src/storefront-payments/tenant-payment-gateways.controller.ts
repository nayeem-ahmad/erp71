import { Body, Controller, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SETTINGS_ADMIN } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PaymentProviderCatalogService } from './payment-provider-catalog.service';
import { UpdateTenantGatewayDto } from './storefront-payments.dto';

/**
 * A shop's own merchant accounts. The tenant only ever sees and edits its own
 * credentials; the provider catalog itself is read-only here.
 */
@Controller('tenants/storefront-payment-gateways')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class TenantPaymentGatewaysController {
    constructor(private readonly catalog: PaymentProviderCatalogService) {}

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Get()
    list(@Tenant() tenant: TenantContext) {
        return this.catalog.listForTenant(tenant.tenantId);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Patch(':providerId')
    update(
        @Tenant() tenant: TenantContext,
        @Param('providerId') providerId: string,
        @Body() dto: UpdateTenantGatewayDto,
    ) {
        return this.catalog.updateTenantGateway(tenant.tenantId, providerId, dto);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Post(':providerId/test')
    test(@Tenant() tenant: TenantContext, @Param('providerId') providerId: string) {
        return this.catalog.testTenantGateway(tenant.tenantId, providerId);
    }
}
