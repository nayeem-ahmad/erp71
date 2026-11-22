import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { SUBSCRIPTION_FEATURE_KEY } from '../auth/subscription-access.decorator';
import { CrmReportsController } from './crm-reports.controller';

describe('CrmReportsController', () => {
    let controller: CrmReportsController;
    let leadSourceService: { report: jest.Mock };
    let followUpService: { report: jest.Mock };
    let scorecardService: { report: jest.Mock };
    let leadAgingService: { report: jest.Mock };
    let activitySummaryService: { report: jest.Mock };
    let campaignPerformanceService: { report: jest.Mock };
    let birthdaysService: { report: jest.Mock };
    let contactCoverageService: { report: jest.Mock };
    let rfmService: { report: jest.Mock };
    let leadFunnelService: { report: jest.Mock };
    let lostLeadsService: { report: jest.Mock };

    const tenant = { tenantId: 'tenant-1', userId: 'user-1', timezone: 'UTC' } as any;

    const perms = (name: string) =>
        Reflect.getMetadata(STORE_PERMISSIONS_KEY, (CrmReportsController.prototype as any)[name]);

    beforeEach(() => {
        leadSourceService = { report: jest.fn().mockResolvedValue({ rows: [], totals: {} }) };
        followUpService = { report: jest.fn().mockResolvedValue({ by_assignee: [], by_purpose: [], totals: {} }) };
        scorecardService = { report: jest.fn().mockResolvedValue({ rows: [], totals: {} }) };
        leadAgingService = { report: jest.fn().mockResolvedValue({ buckets: [], by_stage: [], totals: {} }) };
        activitySummaryService = { report: jest.fn().mockResolvedValue({ channels: [], rows: [], totals: {} }) };
        campaignPerformanceService = { report: jest.fn().mockResolvedValue({ rows: [], by_channel: [], totals: {} }) };
        birthdaysService = { report: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
        contactCoverageService = { report: jest.fn().mockResolvedValue({ by_party: [], by_source: [], totals: {} }) };
        rfmService = { report: jest.fn().mockResolvedValue({ rows: [], by_segment: [], totals: {} }) };
        leadFunnelService = { report: jest.fn().mockResolvedValue({ months: [], rows: [], totals: {} }) };
        lostLeadsService = { report: jest.fn().mockResolvedValue({ rows: [], by_reason: [], totals: {} }) };

        controller = new CrmReportsController(
            leadSourceService as any,
            followUpService as any,
            scorecardService as any,
            leadAgingService as any,
            activitySummaryService as any,
            campaignPerformanceService as any,
            birthdaysService as any,
            contactCoverageService as any,
            rfmService as any,
            leadFunnelService as any,
            lostLeadsService as any,
        );
    });

    it('requires premiumCrm', () => {
        expect(Reflect.getMetadata(SUBSCRIPTION_FEATURE_KEY, CrmReportsController)).toBe('premiumCrm');
    });

    it('gates every report on the permission its data belongs to', () => {
        expect(perms('leadSources')).toEqual([StorePermission.VIEW_LEADS]);
        expect(perms('scorecard')).toEqual([StorePermission.VIEW_LEADS]);
        expect(perms('leadAging')).toEqual([StorePermission.VIEW_LEADS]);
        expect(perms('leadFunnel')).toEqual([StorePermission.VIEW_LEADS]);
        expect(perms('lostLeads')).toEqual([StorePermission.VIEW_LEADS]);

        expect(perms('followUpCompliance')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
        expect(perms('activitySummary')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
        expect(perms('campaigns')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
        expect(perms('birthdays')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
        expect(perms('contactCoverage')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
        expect(perms('rfm')).toEqual([StorePermission.VIEW_CRM_INTERACTIONS]);
    });

    it('resolves mine from the session on the reports that offer it', async () => {
        await controller.leadSources(tenant, { mine: true } as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', { mine: true }, 'UTC', 'user-1');

        await controller.leadSources(tenant, {} as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', {}, 'UTC', undefined);
    });

    it('resolves mine for lead aging, and passes no window', async () => {
        await controller.leadAging(tenant, { mine: true } as any);
        // No window argument: aging is a stock figure, not a period one.
        expect(leadAgingService.report).toHaveBeenCalledWith('tenant-1', 'user-1', 'UTC');

        await controller.leadAging(tenant, {} as any);
        expect(leadAgingService.report).toHaveBeenCalledWith('tenant-1', undefined, 'UTC');
    });

    it('passes the window through for the period reports', async () => {
        await controller.activitySummary(tenant, { mine: true, from: '2026-11-01', to: '2026-11-15' } as any);
        expect(activitySummaryService.report).toHaveBeenCalledWith(
            'tenant-1',
            { mine: true, from: '2026-11-01', to: '2026-11-15' },
            'UTC',
            'user-1',
        );

        await controller.campaigns(tenant, { from: '2026-11-01', to: '2026-11-15', mine: true } as any);
        expect(campaignPerformanceService.report).toHaveBeenCalledWith(
            'tenant-1',
            { from: '2026-11-01', to: '2026-11-15', mine: true },
            'UTC',
        );

        await controller.birthdays(tenant, { days: 7 } as any);
        expect(birthdaysService.report).toHaveBeenCalledWith('tenant-1', { days: 7 }, 'UTC');
    });

    it('leaves the snapshot reports without a window', async () => {
        await controller.contactCoverage(tenant);
        expect(contactCoverageService.report).toHaveBeenCalledWith('tenant-1');

        await controller.rfm(tenant);
        expect(rfmService.report).toHaveBeenCalledWith('tenant-1', 'UTC');
    });

    it('narrows the lead reports to the caller under mine', async () => {
        await controller.leadFunnel(tenant, { mine: true, from: '2026-01-01', to: '2026-11-15' } as any);
        expect(leadFunnelService.report).toHaveBeenCalledWith(
            'tenant-1',
            'UTC',
            { from: '2026-01-01', to: '2026-11-15' },
            'user-1',
        );

        await controller.lostLeads(tenant, { mine: true } as any);
        expect(lostLeadsService.report).toHaveBeenCalledWith('tenant-1', { mine: true }, 'UTC', 'user-1');
    });
});
