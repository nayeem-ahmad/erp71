import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { TenantExternalSyncController } from './tenant-external-sync.controller';

/**
 * The tenant-facing route exposes an import that writes documents across a
 * whole business and stores third-party credentials, so the two gates and the
 * one withheld capability are worth pinning explicitly.
 */
describe('TenantExternalSyncController', () => {
    const OWNER = { tenantId: 't1', userId: 'u1', userRole: 'OWNER' } as any;
    const MANAGER = { tenantId: 't1', userId: 'u2', userRole: 'MANAGER' } as any;

    function build(featureEnabled: boolean) {
        const service = {
            getConnection: jest.fn(async () => null),
            upsertConnection: jest.fn(async () => ({})) as jest.Mock,
            startRun: jest.fn(async () => ({})),
            listRuns: jest.fn(async () => []),
            cancelRun: jest.fn(async () => ({ cancelling: true })),
            deleteConnection: jest.fn(async () => ({ deleted: true })),
            testConnection: jest.fn(async () => ({ ok: true })),
        };
        const platformSettings = { isFeatureEnabledForTenant: jest.fn(async () => featureEnabled) };
        return {
            controller: new TenantExternalSyncController(service as any, platformSettings as any),
            service,
            platformSettings,
        };
    }

    it('is invisible until the platform enables it for this tenant', async () => {
        const { controller, service } = build(false);

        await expect(controller.getConnection(OWNER)).rejects.toThrow(ServiceUnavailableException);
        expect(service.getConnection).not.toHaveBeenCalled();
    });

    it('checks the flag against this tenant, not the platform default', async () => {
        const { controller, platformSettings } = build(true);
        await controller.getConnection(OWNER);

        expect(platformSettings.isFeatureEnabledForTenant).toHaveBeenCalledWith('externalImport', 't1');
    });

    it('refuses anyone but the workspace owner', async () => {
        const { controller, service } = build(true);

        await expect(controller.getConnection(MANAGER)).rejects.toThrow(ForbiddenException);
        await expect(controller.startRun(MANAGER, {} as any)).rejects.toThrow(ForbiddenException);
        expect(service.getConnection).not.toHaveBeenCalled();
        expect(service.startRun).not.toHaveBeenCalled();
    });

    it('lets the owner through once enabled', async () => {
        const { controller, service } = build(true);
        await controller.startRun(OWNER, { dryRun: true } as any);

        expect(service.startRun).toHaveBeenCalledWith('t1', { dryRun: true }, 'MANUAL', 'u1');
    });

    it('drops postImpacts, which stays a platform-admin decision', async () => {
        const { controller, service } = build(true);
        await controller.upsertConnection(OWNER, {
            baseUrl: 'https://example.com',
            username: 'u',
            storeId: 's1',
            postImpacts: true,
        } as any);

        const [, dto] = (service.upsertConnection as jest.Mock).mock.calls[0];
        // Posting a replayed history into stock and the ledger double-counts a
        // workspace that already has opening balances.
        expect(dto).not.toHaveProperty('postImpacts');
        expect(dto.baseUrl).toBe('https://example.com');
    });

    it('gates cancellation too, so a run cannot be stopped from another workspace', async () => {
        const { controller, service } = build(true);
        await controller.cancelRun(OWNER, 'run-1');

        expect(service.cancelRun).toHaveBeenCalledWith('t1', 'run-1');
    });
});
