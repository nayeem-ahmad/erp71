import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PlatformWorkspaceService, PLATFORM_WORKSPACE_NAME } from './platform-workspace.service';

describe('PlatformWorkspaceService', () => {
    let service: PlatformWorkspaceService;

    const db = {
        tenant: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
        tenantUser: {
            upsert: jest.fn(),
            createMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
    };

    const platformSettings = { isFeatureEnabled: jest.fn() };

    const workspace = { id: 'ws-1', name: PLATFORM_WORKSPACE_NAME, timezone: 'Asia/Dhaka' };

    beforeEach(async () => {
        jest.clearAllMocks();
        platformSettings.isFeatureEnabled.mockResolvedValue(true);
        db.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
        db.tenantUser.createMany.mockResolvedValue({ count: 2 });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlatformWorkspaceService,
                { provide: DatabaseService, useValue: db },
                { provide: PlatformSettingsService, useValue: platformSettings },
            ],
        }).compile();

        service = module.get(PlatformWorkspaceService);
    });

    describe('resolveForAdmin', () => {
        it('provisions the workspace on first use and seeds it with every platform admin', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            db.tenant.create.mockResolvedValue(workspace);

            await expect(service.resolveForAdmin('admin-1')).resolves.toEqual(workspace);

            expect(db.tenant.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        name: PLATFORM_WORKSPACE_NAME,
                        owner_id: 'admin-1',
                        is_platform_workspace: true,
                    }),
                }),
            );
            expect(db.tenantUser.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        { tenant_id: 'ws-1', user_id: 'admin-1', role: 'OWNER' },
                        { tenant_id: 'ws-1', user_id: 'admin-2', role: 'OWNER' },
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        it('reuses the existing workspace rather than creating a second one', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await expect(service.resolveForAdmin('admin-2')).resolves.toEqual(workspace);

            expect(db.tenant.create).not.toHaveBeenCalled();
        });

        // Two admins opening the module at the same moment both see no workspace
        // and both try to create one. The partial unique index means the loser's
        // insert throws; it has to end up in the winner's workspace, not error.
        it('falls back to the row a concurrent caller won the race with', async () => {
            db.tenant.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(workspace);
            db.tenant.create.mockRejectedValue(new Error('duplicate key'));

            await expect(service.resolveForAdmin('admin-1')).resolves.toEqual(workspace);
        });

        it('rethrows when the create failed for a reason other than losing the race', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            db.tenant.create.mockRejectedValue(new Error('connection reset'));

            await expect(service.resolveForAdmin('admin-1')).rejects.toThrow('connection reset');
        });

        it('makes the caller an OWNER member without disturbing an existing row', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await service.resolveForAdmin('admin-3');

            expect(db.tenantUser.upsert).toHaveBeenCalledWith({
                where: { tenant_id_user_id: { tenant_id: 'ws-1', user_id: 'admin-3' } },
                create: { tenant_id: 'ws-1', user_id: 'admin-3', role: 'OWNER' },
                update: {},
            });
        });

        it('refuses when the platform switch is off, and provisions nothing', async () => {
            platformSettings.isFeatureEnabled.mockResolvedValue(false);

            await expect(service.resolveForAdmin('admin-1')).rejects.toThrow(ForbiddenException);
            expect(db.tenant.findFirst).not.toHaveBeenCalled();
            expect(db.tenant.create).not.toHaveBeenCalled();
        });
    });

    describe('find', () => {
        it('only ever matches a live workspace, never a deleted one', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            await service.find();

            expect(db.tenant.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { is_platform_workspace: true, deleted_at: null },
                }),
            );
        });
    });

    describe('membership sync', () => {
        it('pulls in admins promoted since the workspace was created', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);
            db.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-9' }]);

            await service.resolveForAdmin('admin-1');

            expect(db.tenantUser.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        { tenant_id: 'ws-1', user_id: 'admin-1', role: 'OWNER' },
                        { tenant_id: 'ws-1', user_id: 'admin-9', role: 'OWNER' },
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        it('writes nothing when the admin roster comes back empty', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);
            db.user.findMany.mockResolvedValue([]);

            await service.resolveForAdmin('admin-1');

            expect(db.tenantUser.createMany).not.toHaveBeenCalled();
            // The caller still gets their own membership, so the pages they just
            // opened work even when the roster query finds nobody.
            expect(db.tenantUser.upsert).toHaveBeenCalled();
        });
    });
});
