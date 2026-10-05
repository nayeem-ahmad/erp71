import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { PurchaseDashboardService } from './purchase-dashboard.service';
import { PurchaseDashboardQueryDto } from './purchase-dashboard.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ } from '../auth/permission-sets';
/**
 * Guarded exactly as `PurchaseReportsController` is — the same role gate and the
 * same `BASIC` floor. This dashboard is those reports folded into one payload,
 * so anything it shows was already reachable by whoever can reach it.
 */
@Controller('purchases/dashboard')
@UseGuards(JwtAuthGuard, StorePermissionGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class PurchaseDashboardController {
    constructor(
        private readonly service: PurchaseDashboardService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('overview')
    async getOverview(@Tenant() tenant: TenantContext, @Query() query: PurchaseDashboardQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.service.getOverview(tenant.tenantId, { ...query, storeId }, tenant.timezone);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('trends')
    async getTrends(@Tenant() tenant: TenantContext, @Query() query: PurchaseDashboardQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        return this.service.getTrends(tenant.tenantId, { ...query, storeId }, tenant.timezone);
    }
}
