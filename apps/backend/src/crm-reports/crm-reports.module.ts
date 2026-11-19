import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { CrmReportsController } from './crm-reports.controller';
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
import { CrmLostLeadsService } from './crm-lost-leads.service';

@Module({
    controllers: [CrmReportsController],
    providers: [
        LeadSourceReportService,
        FollowUpComplianceService,
        SalespersonScorecardService,
        LeadAgingService,
        CrmActivitySummaryService,
        CrmCampaignPerformanceService,
        CrmBirthdaysService,
        CrmContactCoverageService,
        CrmRfmService,
        CrmLeadFunnelService,
        CrmLostLeadsService,
        StorePermissionGuard,
        SubscriptionAccessGuard,
    ],
    exports: [
        LeadSourceReportService,
        FollowUpComplianceService,
        SalespersonScorecardService,
        LeadAgingService,
        CrmActivitySummaryService,
        CrmCampaignPerformanceService,
        CrmBirthdaysService,
        CrmContactCoverageService,
        CrmRfmService,
        CrmLeadFunnelService,
        CrmLostLeadsService,
    ],
})
export class CrmReportsModule {}
