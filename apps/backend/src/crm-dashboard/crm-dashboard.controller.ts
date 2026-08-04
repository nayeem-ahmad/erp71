import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmDashboardService } from './crm-dashboard.service';
import { CrmDashboardQueryDto } from './crm-dashboard.dto';

/**
 * `VIEW_LEADS` on top of the usual `premiumCrm` gate: every panel here is lead
 * data, and `resolveDashboardVariant` sends a user without that permission to the
 * retail dashboard instead — the two must agree, or the CRM dashboard would be
 * reachable but empty of anything but 403s.
 */
@Controller('crm/dashboard')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@RequireStorePermission(StorePermission.VIEW_LEADS)
@UseInterceptors(TenantInterceptor)
export class CrmDashboardController {
    constructor(private readonly service: CrmDashboardService) {}

    @Get('overview')
    getOverview(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.service.getOverview(tenant.tenantId, query);
    }

    @Get('trends')
    getTrends(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.service.getTrends(tenant.tenantId, query);
    }
}
