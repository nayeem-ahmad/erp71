import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    GetPurchaseLineItemsDto,
    GetPurchaseSummaryDto,
    GetPurchaseTrendDto,
    GetPurchasesByProductDto,
    GetPurchasesBySupplierDto,
} from './purchase-reports.dto';
import { PurchaseReportsService } from './purchase-reports.service';
import { PurchaseLineItemsService } from './purchase-line-items.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ } from '../auth/permission-sets';
@Controller('purchase-reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class PurchaseReportsController {
    constructor(
        private readonly service: PurchaseReportsService,
        private readonly lineItems: PurchaseLineItemsService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('summary')
    getPurchaseSummary(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseSummaryDto) {
        return this.service.getPurchaseSummary(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('trend')
    getPurchaseTrend(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseTrendDto) {
        return this.service.getPurchaseTrend(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('by-product')
    getPurchasesByProduct(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesByProductDto) {
        return this.service.getPurchasesByProduct(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('by-supplier')
    getPurchasesBySupplier(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesBySupplierDto) {
        return this.service.getPurchasesBySupplier(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('line-items')
    getPurchaseLineItems(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseLineItemsDto) {
        return this.lineItems.getPurchaseLineItems(tenant.tenantId, query, tenant.timezone);
    }
}
