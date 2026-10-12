import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { InventoryDashboardService } from './inventory-dashboard.service';
import { InventoryDashboardQueryDto } from './inventory-dashboard.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { INVENTORY_REPORT_READ } from '../auth/permission-sets';
/**
 * Guarded exactly as `InventoryController` is — `JwtAuthGuard` and the tenant
 * scope, nothing more. Deliberately *not* `@RequiresFeature('premiumInventoryReports')`:
 * out-of-stock and reorder counts are the module's basic arithmetic and every
 * plan sees them. The valuation and aging blocks are the premium half, and the
 * service returns them as `null` rather than the controller refusing the whole
 * request — a FREE tenant should get a shorter dashboard, not a 403.
 */
@Controller('inventory/dashboard')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryDashboardController {
    constructor(
        private readonly service: InventoryDashboardService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('overview')
    async getOverview(@Tenant() tenant: TenantContext, @Query() query: InventoryDashboardQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: INVENTORY_REPORT_READ });
        return this.service.getOverview(tenant.tenantId, { ...query, storeId }, tenant.timezone);
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('trends')
    async getTrends(@Tenant() tenant: TenantContext, @Query() query: InventoryDashboardQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: INVENTORY_REPORT_READ });
        return this.service.getTrends(tenant.tenantId, { ...query, storeId }, tenant.timezone);
    }
}
