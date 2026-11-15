import { StorePermission } from '@erp71/shared-types';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { SUBSCRIPTION_FEATURE_KEY } from '../auth/subscription-access.decorator';
import { CrmReportsController } from './crm-reports.controller';

describe('CrmReportsController', () => {
    let controller: CrmReportsController;
    let leadSourceService: { report: jest.Mock };
    let followUpService: { report: jest.Mock };
    let scorecardService: { report: jest.Mock };

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
        controller = new CrmReportsController(
            leadSourceService as any,
            followUpService as any,
            scorecardService as any,
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

    it('resolves mine from the session', async () => {
        await controller.leadSources(tenant, { mine: true } as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', { mine: true }, 'UTC', 'user-1');

        await controller.leadSources(tenant, {} as any);
        expect(leadSourceService.report).toHaveBeenCalledWith('tenant-1', {}, 'UTC', undefined);
    });
});
