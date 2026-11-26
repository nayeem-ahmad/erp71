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
import { LeadAgingService } from './lead-aging.service';
import { CrmActivitySummaryService } from './crm-activity-summary.service';
import { CrmCampaignPerformanceService } from './crm-campaign-performance.service';
import { CrmBirthdaysService } from './crm-birthdays.service';
import { CrmContactCoverageService } from './crm-contact-coverage.service';
import { CrmRfmService } from './crm-rfm.service';
import { CrmLeadFunnelService } from './crm-lead-funnel.service';
import { CrmLeadMovementService } from './crm-lead-movement.service';
import { CrmLostLeadsService } from './crm-lost-leads.service';
import { GetBirthdaysDto, GetLeadMovementDto } from './crm-reports.dto';

@Controller('crm/reports')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmReportsController {
    constructor(
        private readonly leadSourceReportService: LeadSourceReportService,
        private readonly followUpComplianceService: FollowUpComplianceService,
        private readonly scorecardService: SalespersonScorecardService,
        private readonly leadAgingService: LeadAgingService,
        private readonly activitySummaryService: CrmActivitySummaryService,
        private readonly campaignPerformanceService: CrmCampaignPerformanceService,
        private readonly birthdaysService: CrmBirthdaysService,
        private readonly contactCoverageService: CrmContactCoverageService,
        private readonly rfmService: CrmRfmService,
        private readonly leadFunnelService: CrmLeadFunnelService,
        private readonly lostLeadsService: CrmLostLeadsService,
        private readonly leadMovementService: CrmLeadMovementService,
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

    /**
     * Aging is a snapshot of the open pipeline, so it takes no window — only
     * `mine`. A `from`/`to` on a stock figure would answer "leads created in
     * this period that are still open", which is a different question.
     */
    @Get('lead-aging')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    leadAging(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.leadAgingService.report(
            tenant.tenantId,
            this.ownerScope(tenant, query),
            tenant.timezone,
        );
    }

    /** What was done in the window, by type of touch and by person. */
    @Get('activity-summary')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    activitySummary(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.activitySummaryService.report(
            tenant.tenantId,
            query,
            tenant.timezone,
            this.ownerScope(tenant, query),
        );
    }

    /** What each outbound campaign returned, dated by when it was sent. */
    @Get('campaigns')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    campaigns(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.campaignPerformanceService.report(tenant.tenantId, query, tenant.timezone);
    }

    /** Whose birthday is coming up, as a worklist. No window beyond `days`. */
    @Get('birthdays')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    birthdays(@Tenant() tenant: TenantContext, @Query() query: GetBirthdaysDto) {
        return this.birthdaysService.report(tenant.tenantId, query, tenant.timezone);
    }

    /** How much of the book can actually be reached, and which sources bring the unreachable. */
    @Get('contact-coverage')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    contactCoverage(@Tenant() tenant: TenantContext) {
        return this.contactCoverageService.report(tenant.tenantId);
    }

    /** Who is worth what, and who is slipping. A snapshot, so no window. */
    @Get('rfm')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    rfm(@Tenant() tenant: TenantContext) {
        return this.rfmService.report(tenant.tenantId, tenant.timezone);
    }

    /** Each month's arrivals, counted by where that cohort stands now. */
    @Get('lead-funnel')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    leadFunnel(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.leadFunnelService.report(
            tenant.tenantId,
            tenant.timezone,
            { from: query.from, to: query.to },
            this.ownerScope(tenant, query),
        );
    }

    /**
     * Distinct leads that changed stage in the window, counted once at the
     * furthest visible stage. `mine` is the session user, never a client id.
     */
    @Get('lead-movement')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    leadMovement(@Tenant() tenant: TenantContext, @Query() query: GetLeadMovementDto) {
        return this.leadMovementService.report(
            tenant.tenantId,
            tenant.timezone,
            query,
            query.mine ? tenant.userId : undefined,
        );
    }

    /** What we lost in the window, and why. */
    @Get('lost-leads')
    @RequireStorePermission(StorePermission.VIEW_LEADS)
    lostLeads(@Tenant() tenant: TenantContext, @Query() query: CrmDashboardQueryDto) {
        return this.lostLeadsService.report(
            tenant.tenantId,
            query,
            tenant.timezone,
            this.ownerScope(tenant, query),
        );
    }
}
