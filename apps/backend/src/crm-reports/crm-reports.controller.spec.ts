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

    const tenant = { tenantId: 'tenant-1', userId: 'user-1', timezone: 'UTC' } as any;

    beforeEach(() => {
        leadSourceService = {
            report: jest.fn().mockResolvedValue({ rows: [], totals: {} }),
        };
        followUpService = {
            report: jest.fn().mockResolvedValue({ by_assignee: [], by_purpose: [], totals: {} }),
        };
        scorecardService = {
            report: jest.fn().mockResolvedValue({ rows: [], totals: {} }),
        };
        leadAgingService = {
            report: jest.fn().mockResolvedValue({ buckets: [], by_stage: [], totals: {} }),
        };
        activitySummaryService = {
            report: jest.fn().mockResolvedValue({ channels: [], rows: [], totals: {} }),
        };
        controller = new CrmReportsController(
            leadSourceService as any,
            followUpService as any,
            scorecardService as any,
            leadAgingService as any,
            activitySummaryService as any,
        );
    });

    it('requires premiumCrm', () => {
        expect(Reflect.getMetadata(SUBSCRIPTION_FEATURE_KEY, CrmReportsController)).toBe('premiumCrm');
    });

    it('gates lead sources on VIEW_LEADS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.leadSources)).toEqual([
            StorePermission.VIEW_LEADS,
        ]);
    });

    it('gates follow-up compliance on VIEW_CRM_INTERACTIONS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.followUpCompliance)).toEqual([
            StorePermission.VIEW_CRM_INTERACTIONS,
        ]);
    });

    it('gates the scorecard on VIEW_LEADS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.scorecard)).toEqual([
            StorePermission.VIEW_LEADS,
        ]);
    });

    it('gates lead aging on VIEW_LEADS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.leadAging)).toEqual([
            StorePermission.VIEW_LEADS,
        ]);
    });

    it('gates the activity summary on VIEW_CRM_INTERACTIONS', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.activitySummary)).toEqual([
            StorePermission.VIEW_CRM_INTERACTIONS,
        ]);
    });

    it('passes the window and resolves mine for the activity summary', async () => {
        await controller.activitySummary(tenant, { mine: true, from: '2026-11-01', to: '2026-11-15' } as any);
        expect(activitySummaryService.report).toHaveBeenCalledWith(
            'tenant-1',
            { mine: true, from: '2026-11-01', to: '2026-11-15' },
            'UTC',
            'user-1',
        );

        await controller.activitySummary(tenant, {} as any);
        expect(activitySummaryService.report).toHaveBeenCalledWith('tenant-1', {}, 'UTC', undefined);
    });

    it('resolves mine from the session for lead aging, and passes no window', async () => {
        await controller.leadAging(tenant, { mine: true } as any);
        // No window argument: aging is a stock figure, not a period one.
        expect(leadAgingService.report).toHaveBeenCalledWith('tenant-1', 'user-1', 'UTC');

        await controller.leadAging(tenant, {} as any);
        expect(leadAgingService.report).toHaveBeenCalledWith('tenant-1', undefined, 'UTC');
    });

    it('resolves mine from the session', async () => {
        await controller.leadSources(tenant, { mine: true } as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', { mine: true }, 'UTC', 'user-1');

        await controller.leadSources(tenant, {} as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', {}, 'UTC', undefined);
    });
});
