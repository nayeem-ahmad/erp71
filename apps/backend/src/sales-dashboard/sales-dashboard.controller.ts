import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SalesDashboardService } from './sales-dashboard.service';
import { SalesDashboardQueryDto } from './sales-dashboard.dto';

import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALES_READ } from '../auth/permission-sets';
/**
 * Guarded exactly as `SalesReportsController` is — the same store-permission
 * guard and the same `BASIC` floor. This dashboard is those reports folded into
 * one payload, so it shows nothing that was not already reachable by whoever can
 * reach it.
 */
@Controller('sales/dashboard')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class SalesDashboardController {
    constructor(private readonly service: SalesDashboardService) {}

    @RequireAnyStorePermission(...SALES_READ)
    @Get('overview')
    getOverview(@Tenant() tenant: TenantContext, @Query() query: SalesDashboardQueryDto) {
        return this.service.getOverview(tenant.tenantId, query, tenant.timezone);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get('trends')
    getTrends(@Tenant() tenant: TenantContext, @Query() query: SalesDashboardQueryDto) {
        return this.service.getTrends(tenant.tenantId, query, tenant.timezone);
    }
}
