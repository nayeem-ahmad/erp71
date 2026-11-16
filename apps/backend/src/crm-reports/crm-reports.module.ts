import { Module } from '@nestjs/common';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { CrmReportsController } from './crm-reports.controller';
import { LeadSourceReportService } from './lead-source-report.service';
import { FollowUpComplianceService } from './follow-up-compliance.service';
import { SalespersonScorecardService } from './salesperson-scorecard.service';
import { LeadAgingService } from './lead-aging.service';
import { CrmActivitySummaryService } from './crm-activity-summary.service';

@Module({
    controllers: [CrmReportsController],
    providers: [
        LeadSourceReportService,
        FollowUpComplianceService,
        SalespersonScorecardService,
        LeadAgingService,
        CrmActivitySummaryService,
        StorePermissionGuard,
        SubscriptionAccessGuard,
    ],
    exports: [
        LeadSourceReportService,
        FollowUpComplianceService,
        SalespersonScorecardService,
        LeadAgingService,
        CrmActivitySummaryService,
    ],
})
export class CrmReportsModule {}
