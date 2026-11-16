import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmDashboardQueryDto } from '../crm-dashboard/crm-dashboard.dto';
import { LeadSourceReportService } from './lead-source-report.service';
import { FollowUpComplianceService } from './follow-up-compliance.service';
import { SalespersonScorecardService } from './salesperson-scorecard.service';

@Controller('crm/reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmReportsController {
    constructor(
        private readonly leadSourceReportService: LeadSourceReportService,
        private readonly followUpComplianceService: FollowUpComplianceService,
        private readonly scorecardService: SalespersonScorecardService,
    ) {}

    private ownerScope(tenant: TenantContext, query: CrmDashboardQueryDto): string | undefined {
        return query.mine ? tenant.userId : undefined;
    }

    @Get('lead-sources')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    leadSources(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.leadSourceReportService.report(
            tenant.tenantId,
            query,
            tenant.timezone,
            this.ownerScope(tenant, query),
        );
    }

    @Get('follow-up-compliance')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    followUpCompliance(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.followUpComplianceService.report(
            tenant.tenantId,
            query,
            tenant.timezone,
            this.ownerScope(tenant, query),
        );
    }

    @Get('scorecard')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    scorecard(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.scorecardService.report(
            tenant.tenantId,
            query,
            tenant.timezone,
            this.ownerScope(tenant, query),
        );
    }
}
