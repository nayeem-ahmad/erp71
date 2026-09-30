import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ExternalSyncController } from './external-sync.controller';
import { TenantExternalSyncController } from './tenant-external-sync.controller';

const OWNER = { tenantId: 'tenant-1', userRole: 'OWNER', userId: 'u1' } as any;
const MANAGER = { tenantId: 'tenant-1', userRole: 'MANAGER', userId: 'u2' } as any;

function makeSnapshots() {
    return {
        startExtract: jest.fn().mockResolvedValue({ id: 'snap-1', status: 'EXTRACTING' }),
        listSnapshots: jest.fn().mockResolvedValue([]),
        getSnapshot: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        cancelExtract: jest.fn().mockResolvedValue({ cancelling: true }),
        openFile: jest.fn().mockResolvedValue({ path: '/tmp/x.json.gz', filename: 'x.json.gz', byteSize: 1 }),
        uploadSnapshot: jest.fn().mockResolvedValue({ id: 'snap-1', status: 'READY' }),
        deleteSnapshot: jest.fn().mockResolvedValue({ deleted: true }),
    };
}

describe('snapshot routes — platform admin', () => {
    const snapshots = makeSnapshots();
    const controller = new ExternalSyncController({} as any, {} as any, snapshots as any);

    beforeEach(() => jest.clearAllMocks());

    it('passes the tenantId from the URL to startExtract', async () => {
        await controller.startExtract('tenant-1', { provider: 'EXPRESS_RETAIL_PRO' }, { user: { userId: 'admin-1' } });
        expect(snapshots.startExtract).toHaveBeenCalledWith(
            'tenant-1',
            { provider: 'EXPRESS_RETAIL_PRO' },
            'admin-1',
        );
    });
});

describe('snapshot routes — tenant facing', () => {
    const snapshots = makeSnapshots();
    const platformSettings = { isFeatureEnabledForTenant: jest.fn().mockResolvedValue(true) };
    const controller = new TenantExternalSyncController({} as any, platformSettings as any, {} as any, snapshots as any);

    beforeEach(() => {
        jest.clearAllMocks();
        platformSettings.isFeatureEnabledForTenant.mockResolvedValue(true);
    });

    it('lets an owner start an extract', async () => {
        await controller.startExtract(OWNER, { dateFrom: '2026-01-01' });
        expect(snapshots.startExtract).toHaveBeenCalledWith('tenant-1', { dateFrom: '2026-01-01' }, 'u1');
    });

    it('rejects a non-owner starting an extract', async () => {
        await expect(controller.startExtract(MANAGER, {})).rejects.toBeInstanceOf(ForbiddenException);
        expect(snapshots.startExtract).not.toHaveBeenCalled();
    });

    it('rejects when the externalImport feature is off for the tenant', async () => {
        platformSettings.isFeatureEnabledForTenant.mockResolvedValue(false);
        await expect(controller.startExtract(OWNER, {})).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(snapshots.startExtract).not.toHaveBeenCalled();
    });

    it('rejects upload without a file', async () => {
        await expect(controller.uploadSnapshot(OWNER, undefined, undefined)).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(snapshots.uploadSnapshot).not.toHaveBeenCalled();
    });
});
