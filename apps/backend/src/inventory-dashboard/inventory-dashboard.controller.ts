import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { InventoryDashboardService } from './inventory-dashboard.service';
import { InventoryDashboardQueryDto } from './inventory-dashboard.dto';

/**
 * Guarded exactly as `InventoryController` is — `JwtAuthGuard` and the tenant
 * scope, nothing more. Deliberately *not* `@RequiresFeature('premiumInventoryReports')`:
 * out-of-stock and reorder counts are the module's basic arithmetic and every
 * plan sees them. The valuation and aging blocks are the premium half, and the
 * service returns them as `null` rather than the controller refusing the whole
 * request — a FREE tenant should get a shorter dashboard, not a 403.
 */
@Controller('inventory/dashboard')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryDashboardController {
    constructor(private readonly service: InventoryDashboardService) {}

    @Get('overview')
    getOverview(@Tenant() tenant: TenantContext, @Query() query: InventoryDashboardQueryDto) {
        return this.service.getOverview(tenant.tenantId, query, tenant.timezone);
    }

    @Get('trends')
    getTrends(@Tenant() tenant: TenantContext, @Query() query: InventoryDashboardQueryDto) {
        return this.service.getTrends(tenant.tenantId, query, tenant.timezone);
    }
}
