import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PurchaseDashboardService } from './purchase-dashboard.service';
import { PurchaseDashboardQueryDto } from './purchase-dashboard.dto';

/**
 * Guarded exactly as `PurchaseReportsController` is — the same role gate and the
 * same `BASIC` floor. This dashboard is those reports folded into one payload,
 * so anything it shows was already reachable by whoever can reach it.
 */
@Controller('purchases/dashboard')
@UseGuards(JwtAuthGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class PurchaseDashboardController {
    constructor(private readonly service: PurchaseDashboardService) {}

    @Get('overview')
    getOverview(@Tenant() tenant: TenantContext, @Query() query: PurchaseDashboardQueryDto) {
        return this.service.getOverview(tenant.tenantId, query, tenant.timezone);
    }

    @Get('trends')
    getTrends(@Tenant() tenant: TenantContext, @Query() query: PurchaseDashboardQueryDto) {
        return this.service.getTrends(tenant.tenantId, query, tenant.timezone);
    }
}
