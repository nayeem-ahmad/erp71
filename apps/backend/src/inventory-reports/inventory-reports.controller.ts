import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import {
    GetInventoryValuationDto,
    GetProductTransactionHistoryDto,
    GetReorderSuggestionsDto,
    GetShrinkageSummaryDto,
    GetStockAgingDto,
    GetStockOnHandDto,
} from './inventory-reports.dto';
import { InventoryReportsService } from './inventory-reports.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { INVENTORY_REPORT_READ } from '../auth/permission-sets';
@Controller('inventory-reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresFeature('premiumInventoryReports')
export class InventoryReportsController {
    constructor(
        private readonly service: InventoryReportsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    /**
     * The branch the report covers, checked against the caller's access. A
     * `warehouseId` keeps combining with it in the service, so a warehouse
     * outside the resolved branch reports nothing rather than another branch.
     */
    private async scoped<T extends { storeId?: string }>(tenant: TenantContext, query: T): Promise<T> {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: INVENTORY_REPORT_READ });
        return { ...query, storeId };
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('reorder-suggestions')
    async getReorderSuggestions(@Tenant() tenant: TenantContext, @Query() query: GetReorderSuggestionsDto) {
        return this.service.getReorderSuggestions(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('valuation')
    async getInventoryValuation(@Tenant() tenant: TenantContext, @Query() query: GetInventoryValuationDto) {
        return this.service.getInventoryValuation(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('stock-on-hand')
    async getStockOnHand(@Tenant() tenant: TenantContext, @Query() query: GetStockOnHandDto) {
        return this.service.getStockOnHand(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('stock-aging')
    async getStockAging(@Tenant() tenant: TenantContext, @Query() query: GetStockAgingDto) {
        return this.service.getStockAging(tenant.tenantId, await this.scoped(tenant, query));
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('shrinkage-summary')
    async getShrinkageSummary(@Tenant() tenant: TenantContext, @Query() query: GetShrinkageSummaryDto) {
        return this.service.getShrinkageSummary(tenant.tenantId, await this.scoped(tenant, query));
    }

    /**
     * The tenant's zone is threaded through rather than defaulted in the
     * service: this report cuts an opening balance at the start of `from`, and a
     * boundary an hour out moves a day's movements to the wrong side of it.
     */
    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('product-transaction-history')
    async getProductTransactionHistory(@Tenant() tenant: TenantContext, @Query() query: GetProductTransactionHistoryDto) {
        return this.service.getProductTransactionHistory(tenant.tenantId, await this.scoped(tenant, query), tenant.timezone);
    }
}