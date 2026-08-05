import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { HrDashboardService } from './hr-dashboard.service';
import { HrDashboardQueryDto } from './hr-dashboard.dto';

/**
 * `VIEW_HR` gates the whole dashboard; `VIEW_PAYROLL` gates the money on it,
 * checked inside the service so a user without it gets a shorter dashboard
 * rather than a 403.
 *
 * Note that `EmployeesController` still guards with `JwtAuthGuard` alone, so
 * these permissions are stricter than the endpoints they summarise. That gap is
 * pre-existing and tracked separately — closing it here would have silently
 * revoked the employee list from everyone who can see it today.
 */
@Controller('hr/dashboard')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class HrDashboardController {
    constructor(private readonly service: HrDashboardService) {}

    @Get('overview')
    getOverview(@Tenant() tenant: TenantContext, @Query() query: HrDashboardQueryDto) {
        return this.service.getOverview(tenant, query);
    }

    @Get('trends')
    getTrends(@Tenant() tenant: TenantContext, @Query() query: HrDashboardQueryDto) {
        return this.service.getTrends(tenant.tenantId, query);
    }
}
