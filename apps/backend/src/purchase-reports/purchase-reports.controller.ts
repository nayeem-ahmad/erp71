import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
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
        private readonly branchScope: BranchScopeService,
    ) {}

    /** The branch a report covers, checked against the caller's access. */
    private async scoped<T extends { storeId?: string }>(tenant: TenantContext, query: T): Promise<T> {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return { ...query, storeId };
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('summary')
    async getPurchaseSummary(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseSummaryDto) {
        return this.service.getPurchaseSummary(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('trend')
    async getPurchaseTrend(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseTrendDto) {
        return this.service.getPurchaseTrend(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('by-product')
    async getPurchasesByProduct(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesByProductDto) {
        return this.service.getPurchasesByProduct(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('by-supplier')
    async getPurchasesBySupplier(@Tenant() tenant: TenantContext, @Query() query: GetPurchasesBySupplierDto) {
        return this.service.getPurchasesBySupplier(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('line-items')
    async getPurchaseLineItems(@Tenant() tenant: TenantContext, @Query() query: GetPurchaseLineItemsDto) {
        return this.lineItems.getPurchaseLineItems(tenant.tenantId, await this.scoped(tenant, query), tenant.timezone);
    }
}
