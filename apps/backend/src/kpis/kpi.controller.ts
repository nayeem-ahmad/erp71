import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { TenantKpiService } from './tenant-kpi.service';
import { PlatformKpiService } from './platform-kpi.service';
import { PlatformKpiQueryDto, TenantKpiQueryDto } from './kpi.dto';

const KPI_READ = [StorePermission.VIEW_FINANCIAL_REPORTS];

/**
 * A shop's KPI scorecard. Margins, cash and runway are the business's books,
 * so it is gated like the financial reports: VIEW_FINANCIAL_REPORTS, and the
 * whole business only for an owner or a consolidated-reports holder. Open on
 * every plan: the sidebar's legacy gate has no notion of paid plans, and a
 * free workspace with no books simply sees "not enough data" on ledger KPIs.
 */
@Controller('kpis')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
export class TenantKpiController {
    constructor(
        private readonly service: TenantKpiService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...KPI_READ)
    @Get()
    async getScorecard(@Tenant() tenant: TenantContext, @Query() query: TenantKpiQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: KPI_READ });
        return this.service.getScorecard(tenant.tenantId, query, storeId, tenant.timezone);
    }
}

/**
 * ERP71's own scorecard. Platform-scoped like the admin dashboard: no
 * `TenantInterceptor`, because the figures span every tenant.
 */
@Controller('admin/kpis')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformKpiController {
    constructor(private readonly service: PlatformKpiService) {}

    @Get()
    getScorecard(@Query() query: PlatformKpiQueryDto) {
        return this.service.getScorecard(query);
    }
}
