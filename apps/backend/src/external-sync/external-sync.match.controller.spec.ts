import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ExternalSyncController } from './external-sync.controller';
import { TenantExternalSyncController } from './tenant-external-sync.controller';
import type { ApplyMatchDecisionsDto } from './external-sync.match.dto';

const DECISIONS = { manifest: {}, rows: [] } as unknown as ApplyMatchDecisionsDto;

function makeMatchService() {
    return {
        getCandidates: jest.fn().mockResolvedValue({ manifest: {}, rows: [] }),
        applyDecisions: jest.fn().mockResolvedValue({ applied: 0, skipped: 0 }),
    };
}

describe('match routes — platform admin', () => {
    const matchService = makeMatchService();
    const controller = new ExternalSyncController({} as any, matchService as any);

    beforeEach(() => jest.clearAllMocks());

    it('passes the tenantId from the URL to getCandidates', async () => {
        await controller.getMatchCandidates('tenant-1', 'EXPRESS_RETAIL_PRO');
        expect(matchService.getCandidates).toHaveBeenCalledWith('tenant-1', 'EXPRESS_RETAIL_PRO');
    });

    it('passes the tenantId from the URL to applyMatchDecisions', async () => {
        await controller.applyMatchDecisions('tenant-1', DECISIONS);
        expect(matchService.applyDecisions).toHaveBeenCalledWith('tenant-1', DECISIONS);
    });
});

describe('match routes — tenant facing', () => {
    const matchService = makeMatchService();
    const platformSettings = { isFeatureEnabledForTenant: jest.fn().mockResolvedValue(true) };
    const controller = new TenantExternalSyncController({} as any, platformSettings as any, matchService as any);

    const owner = { tenantId: 'tenant-1', userRole: 'OWNER', userId: 'u1' } as any;
    const manager = { tenantId: 'tenant-1', userRole: 'MANAGER', userId: 'u2' } as any;

    beforeEach(() => {
        jest.clearAllMocks();
        platformSettings.isFeatureEnabledForTenant.mockResolvedValue(true);
    });

    it('uses the interceptor tenant, never a client-supplied id', async () => {
        await controller.getMatchCandidates(owner, undefined);
        expect(matchService.getCandidates).toHaveBeenCalledWith('tenant-1', undefined);
    });

    it('rejects a non-owner reading candidates', async () => {
        await expect(controller.getMatchCandidates(manager, undefined)).rejects.toBeInstanceOf(ForbiddenException);
        expect(matchService.getCandidates).not.toHaveBeenCalled();
    });

    it('rejects a non-owner applying decisions', async () => {
        await expect(controller.applyMatchDecisions(manager, DECISIONS)).rejects.toBeInstanceOf(ForbiddenException);
        expect(matchService.applyDecisions).not.toHaveBeenCalled();
    });

    it('rejects when the externalImport feature is off for the tenant', async () => {
        platformSettings.isFeatureEnabledForTenant.mockResolvedValue(false);
        await expect(controller.getMatchCandidates(owner, undefined)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(matchService.getCandidates).not.toHaveBeenCalled();
    });

    it('lets an owner apply decisions', async () => {
        await controller.applyMatchDecisions(owner, DECISIONS);
        expect(matchService.applyDecisions).toHaveBeenCalledWith('tenant-1', DECISIONS);
    });
});
